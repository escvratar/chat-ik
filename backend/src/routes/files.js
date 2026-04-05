import { pool, minio, BUCKET } from '../index.js'
import { randomUUID } from 'crypto'
import { Transform } from 'stream'

export default async function fileRoutes(app) {
  // POST /api/files/upload — upload encrypted file blob
  app.post('/upload', { preHandler: [app.authenticate] }, async (req, reply) => {
    const data = await req.file()
    if (!data) return reply.code(400).send({ error: 'No file' })

    const fileId = randomUUID()
    const ext = data.filename.split('.').pop()
    const objectKey = `${fileId}.${ext}`

    let sizeBytes = 0
    const countingStream = new Transform({
      transform(chunk, _encoding, callback) {
        sizeBytes += chunk.length
        callback(null, chunk)
      }
    })

    await minio.putObject(BUCKET, objectKey, data.file.pipe(countingStream), undefined, {
      'Content-Type': data.mimetype,
      'x-original-name': encodeURIComponent(data.filename),
    })

    const { rows } = await pool.query(
      `INSERT INTO files (id, uploader_id, object_key, original_name, mime_type, size_bytes)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [fileId, req.user.id, objectKey, data.filename, data.mimetype, sizeBytes]
    )

    return { file_id: rows[0].id, mime_type: data.mimetype, size: sizeBytes, name: data.filename }
  })

  // GET /api/files/:id — download file (streams from MinIO)
  app.get('/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { rows } = await pool.query(
      'SELECT * FROM files WHERE id=$1', [req.params.id]
    )
    if (!rows.length) return reply.code(404).send({ error: 'Not found' })

    const file = rows[0]
    const stream = await minio.getObject(BUCKET, file.object_key)

    const safeName = encodeURIComponent(file.original_name || 'file')
    reply.header('Content-Type', file.mime_type || 'application/octet-stream')
    reply.header('Content-Disposition', `inline; filename*=UTF-8''${safeName}`)
    return reply.send(stream)
  })
}
