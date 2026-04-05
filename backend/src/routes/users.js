import { pool, minio, BUCKET, sendPushNotification } from '../index.js'
import { randomUUID } from 'crypto'

export default async function userRoutes(app) {
  const onlineExpr = `CASE WHEN COALESCE(last_seen, NOW() - INTERVAL '1 day') > NOW() - INTERVAL '70 seconds' THEN true ELSE false END`
  const buildAvatarUrl = (userId, objectKey) => objectKey ? `/api/users/${userId}/avatar?v=${encodeURIComponent(objectKey)}` : null

  // GET /api/users/me
  app.get('/me', { preHandler: [app.authenticate] }, async (req) => {
    const { rows } = await pool.query(
      `SELECT id, username, display_name, avatar_color, avatar_object_key, avatar_mime_type, public_key, encrypted_secret_key, is_admin,
              ${onlineExpr} AS online, last_seen
       FROM users WHERE id = $1`,
      [req.user.id]
    )
    const user = rows[0]
    return user ? { ...user, avatar_url: buildAvatarUrl(user.id, user.avatar_object_key) } : null
  })

  app.post('/me/heartbeat', { preHandler: [app.authenticate] }, async (req) => {
    await pool.query('UPDATE users SET online=true, last_seen=NOW() WHERE id = $1', [req.user.id])
    return { ok: true, at: new Date().toISOString() }
  })

  app.get('/presence', { preHandler: [app.authenticate] }, async () => {
    const { rows } = await pool.query(
      `SELECT id, ${onlineExpr} AS online, last_seen FROM users`
    )
    return rows
  })

  // POST /api/users/me/avatar — upload user avatar (image)
  app.post('/me/avatar', { preHandler: [app.authenticate] }, async (req, reply) => {
    const data = await req.file()
    if (!data) return reply.code(400).send({ error: 'No file' })
    if (!data.mimetype?.startsWith('image/')) return reply.code(400).send({ error: 'Only images allowed' })

    const ext = data.filename?.split('.').pop() || 'webp'
    const objectKey = `avatar_${req.user.id}_${randomUUID()}.${ext}`

    await minio.putObject(BUCKET, objectKey, data.file, undefined, {
      'Content-Type': data.mimetype,
      'x-original-name': encodeURIComponent(data.filename || 'avatar'),
    })

    const { rows: existing } = await pool.query(
      'SELECT avatar_object_key FROM users WHERE id = $1',
      [req.user.id]
    )
    const oldKey = existing[0]?.avatar_object_key

    await pool.query(
      'UPDATE users SET avatar_object_key = $1, avatar_mime_type = $2 WHERE id = $3',
      [objectKey, data.mimetype, req.user.id]
    )

    if (oldKey && oldKey !== objectKey) {
      minio.removeObject(BUCKET, oldKey).catch(() => {})
    }

    const { rows: userRows } = await pool.query(
      `SELECT id, username, display_name, avatar_color, avatar_object_key, avatar_mime_type, public_key, encrypted_secret_key, is_admin,
              ${onlineExpr} AS online, last_seen
       FROM users WHERE id = $1`,
      [req.user.id]
    )
    const user = userRows[0]
    return user ? { ...user, avatar_url: buildAvatarUrl(user.id, user.avatar_object_key) } : { ok: true }
  })

  // DELETE /api/users/me/avatar — remove avatar
  app.delete('/me/avatar', { preHandler: [app.authenticate] }, async (req) => {
    const { rows } = await pool.query(
      'SELECT avatar_object_key FROM users WHERE id = $1',
      [req.user.id]
    )
    const oldKey = rows[0]?.avatar_object_key
    await pool.query(
      'UPDATE users SET avatar_object_key = NULL, avatar_mime_type = NULL WHERE id = $1',
      [req.user.id]
    )
    if (oldKey) minio.removeObject(BUCKET, oldKey).catch(() => {})
    const { rows: userRows } = await pool.query(
      `SELECT id, username, display_name, avatar_color, avatar_object_key, avatar_mime_type, public_key, encrypted_secret_key, is_admin,
              ${onlineExpr} AS online, last_seen
       FROM users WHERE id = $1`,
      [req.user.id]
    )
    const user = userRows[0]
    return user ? { ...user, avatar_url: buildAvatarUrl(user.id, user.avatar_object_key) } : { ok: true }
  })

  // GET /api/users/:id/avatar — stream avatar image (public)
  app.get('/:id/avatar', async (req, reply) => {
    const { rows } = await pool.query(
      'SELECT avatar_object_key, avatar_mime_type FROM users WHERE id = $1',
      [req.params.id]
    )
    if (!rows.length || !rows[0].avatar_object_key) return reply.code(404).send({ error: 'Not found' })
    const stream = await minio.getObject(BUCKET, rows[0].avatar_object_key)
    reply.header('Content-Type', rows[0].avatar_mime_type || 'image/webp')
    reply.header('Cache-Control', 'private, max-age=3600')
    return reply.send(stream)
  })

  // PUT /api/users/me/key-backup
  app.put('/me/key-backup', { preHandler: [app.authenticate] }, async (req) => {
    const { encrypted_secret_key } = req.body
    await pool.query(
      'UPDATE users SET encrypted_secret_key = $1 WHERE id = $2',
      [encrypted_secret_key, req.user.id]
    )
    return { ok: true }
  })

  // PUT /api/users/me/keys — initialize or replace keypair (public key + encrypted backup)
  app.put('/me/keys', { preHandler: [app.authenticate] }, async (req) => {
    const { public_key, encrypted_secret_key } = req.body || {}
    if (!public_key || !encrypted_secret_key) {
      return { ok: false, error: 'Missing keys' }
    }
    await pool.query(
      'UPDATE users SET public_key = $1, encrypted_secret_key = $2 WHERE id = $3',
      [public_key, encrypted_secret_key, req.user.id]
    )
    const { rows } = await pool.query(
      `SELECT id, username, display_name, avatar_color, avatar_object_key, avatar_mime_type, public_key, encrypted_secret_key, is_admin,
              ${onlineExpr} AS online, last_seen
       FROM users WHERE id = $1`,
      [req.user.id]
    )
    const user = rows[0]
    return user ? { ok: true, user: { ...user, avatar_url: buildAvatarUrl(user.id, user.avatar_object_key) } } : { ok: true }
  })

  // DELETE /api/users/me — Deletes own account and all data (messages/chats follow via cascade)
  app.delete('/me', { preHandler: [app.authenticate] }, async (req) => {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('DELETE FROM call_signals WHERE from_id = $1 OR target_id = $1', [req.user.id])
      await client.query('DELETE FROM push_subscriptions WHERE user_id = $1', [req.user.id])
      await client.query('DELETE FROM session_keys WHERE user_id = $1', [req.user.id])
      await client.query('DELETE FROM messages WHERE sender_id = $1', [req.user.id])
      await client.query('DELETE FROM files WHERE uploader_id = $1', [req.user.id])
      await client.query('DELETE FROM chat_members WHERE user_id = $1', [req.user.id])
      await client.query('DELETE FROM users WHERE id = $1', [req.user.id])
      await client.query(`DELETE FROM chats c
        WHERE NOT EXISTS (
          SELECT 1 FROM chat_members cm WHERE cm.chat_id = c.id
        )`)
      await client.query('COMMIT')
      return { ok: true }
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    } finally {
      client.release()
    }
  })

  // Sessions: GET /api/users/session-key/:userId
  app.get('/session-key/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    // Get latest active session key for a user
    const { rows } = await pool.query(
      'SELECT id, public_key FROM session_keys WHERE user_id=$1 AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1',
      [req.params.id]
    )
    if (!rows.length) return { public_key: null }
    return rows[0]
  })

  // Sessions: POST /api/users/me/session-key
  app.post('/me/session-key', { preHandler: [app.authenticate] }, async (req) => {
    const { public_key } = req.body
    // Expire in 1 hour
    const expiresAt = new Date(Date.now() + 60 * 60000)
    const { rows } = await pool.query(
      'INSERT INTO session_keys (user_id, public_key, expires_at) VALUES ($1, $2, $3) RETURNING id',
      [req.user.id, public_key, expiresAt]
    )
    return rows[0]
  })

  // GET /api/users/search?q=...
  app.get('/search', { preHandler: [app.authenticate] }, async (req) => {
    const q = (req.query.q || '').toLowerCase()
    let query, params
    if (q.length > 0) {
      query = `SELECT id, username, display_name, avatar_color, avatar_object_key, avatar_mime_type, public_key, online, last_seen
               FROM (
                 SELECT id, username, display_name, avatar_color, avatar_object_key, avatar_mime_type, public_key, ${onlineExpr} AS online, last_seen
                 FROM users
               ) u
               WHERE username ILIKE $1 AND id != $2 LIMIT 50`
      params = [`%${q}%`, req.user.id]
    } else {
      query = `SELECT id, username, display_name, avatar_color, avatar_object_key, avatar_mime_type, public_key, online, last_seen
               FROM (
                 SELECT id, username, display_name, avatar_color, avatar_object_key, avatar_mime_type, public_key, ${onlineExpr} AS online, last_seen
                 FROM users
               ) u
               WHERE id != $1 LIMIT 50`
      params = [req.user.id]
    }
    const { rows } = await pool.query(query, params)
    return rows.map(row => ({ ...row, avatar_url: buildAvatarUrl(row.id, row.avatar_object_key) }))
  })

  // GET /api/users/contacts
  app.get('/contacts', { preHandler: [app.authenticate] }, async (req) => {
    const { rows } = await pool.query(
      `SELECT u.id, u.username, u.display_name, u.avatar_color, u.avatar_object_key, u.avatar_mime_type,
              u.public_key, ${onlineExpr} AS online, u.last_seen
       FROM user_contacts uc
       JOIN users u ON u.id = uc.contact_id
       WHERE uc.owner_id = $1
       ORDER BY u.display_name ASC`,
      [req.user.id]
    )
    return rows.map(row => ({ ...row, avatar_url: buildAvatarUrl(row.id, row.avatar_object_key) }))
  })

  // POST /api/users/contacts — add contact by id or username
  app.post('/contacts', { preHandler: [app.authenticate] }, async (req, reply) => {
    const rawIdentifier = (req.body?.identifier || '').trim()
    if (!rawIdentifier) return reply.code(400).send({ error: 'Укажите ID или username' })
    const identifier = rawIdentifier.replace(/^@/, '')

    const { rows } = await pool.query(
      `SELECT id, username, display_name, avatar_color, avatar_object_key, avatar_mime_type,
              public_key, ${onlineExpr} AS online, last_seen
       FROM users
       WHERE id::text = $1 OR LOWER(username) = LOWER($1)
       LIMIT 1`,
      [identifier]
    )
    if (!rows.length) return reply.code(404).send({ error: 'Пользователь не найден' })
    const contact = rows[0]
    if (contact.id === req.user.id) return reply.code(400).send({ error: 'Нельзя добавить себя' })

    await pool.query(
      `INSERT INTO user_contacts (owner_id, contact_id)
       VALUES ($1, $2)
       ON CONFLICT (owner_id, contact_id) DO NOTHING`,
      [req.user.id, contact.id]
    )

    return { ok: true, contact: { ...contact, avatar_url: buildAvatarUrl(contact.id, contact.avatar_object_key) } }
  })

  // DELETE /api/users/contacts/:id — remove contact from own list
  app.delete('/contacts/:id', { preHandler: [app.authenticate] }, async (req) => {
    await pool.query(
      'DELETE FROM user_contacts WHERE owner_id = $1 AND contact_id = $2',
      [req.user.id, req.params.id]
    )
    return { ok: true }
  })

  // GET /api/users/:id/key — get public key for E2E encryption
  app.get('/:id/key', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { rows } = await pool.query(
      'SELECT id, username, public_key FROM users WHERE id = $1', [req.params.id]
    )
    if (!rows.length) return reply.code(404).send({ error: 'Пользователь не найден' })
    return rows[0]
  })

  // GET /api/users/:id
  app.get('/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { rows } = await pool.query(
      `SELECT id, username, display_name, avatar_color, avatar_object_key, avatar_mime_type, public_key, ${onlineExpr} AS online, last_seen
       FROM users WHERE id = $1`,
      [req.params.id]
    )
    if (!rows.length) return reply.code(404).send({ error: 'Не найдено' })
    const user = rows[0]
    return { ...user, avatar_url: buildAvatarUrl(user.id, user.avatar_object_key) }
  })

  app.post('/call-signal', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { target_id, type, payload } = req.body || {}
    if (!target_id || !type) return reply.code(400).send({ error: 'Missing target_id or type' })

    const { rows } = await pool.query(
      `INSERT INTO call_signals (from_id, target_id, signal_type, payload)
       VALUES ($1, $2, $3, $4)
       RETURNING id, from_id, target_id, signal_type, payload, created_at`,
      [req.user.id, target_id, type, payload || {}]
    )
    if (type === 'call:offer') {
      const { rows: senderRows } = await pool.query(
        'SELECT display_name FROM users WHERE id=$1',
        [req.user.id]
      )
      const senderName = senderRows[0]?.display_name || 'Пользователь'
      sendPushNotification(target_id, 'Входящий звонок', `${senderName} звонит вам`, '/', { sender_id: req.user.id, type: 'call' })
    }
    return rows[0]
  })

  app.get('/me/call-signals', { preHandler: [app.authenticate] }, async (req) => {
    const since = req.query.since || new Date(Date.now() - 5 * 60000).toISOString()
    await pool.query('DELETE FROM call_signals WHERE expires_at <= NOW()')
    const { rows } = await pool.query(
      `SELECT cs.id, cs.from_id, cs.target_id, cs.signal_type, cs.payload, cs.created_at,
              u.display_name AS from_name
       FROM call_signals cs
       LEFT JOIN users u ON u.id = cs.from_id
       WHERE cs.target_id = $1 AND cs.created_at >= $2 AND cs.expires_at > NOW()
       ORDER BY cs.created_at ASC
      LIMIT 200`,
      [req.user.id, since]
    )
    if (rows.length) {
      await pool.query('DELETE FROM call_signals WHERE id = ANY($1::uuid[])', [rows.map(row => row.id)])
    }
    return rows
  })

  // POST /api/users/subscribe — register push subscription
  app.post('/subscribe', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { subscription } = req.body
    if (!subscription) return reply.code(400).send({ error: 'Missing subscription' })
    
    await pool.query(
      'INSERT INTO push_subscriptions (user_id, subscription) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [req.user.id, subscription]
    )
    return { ok: true }
  })
}
