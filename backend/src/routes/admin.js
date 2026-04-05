import { pool } from '../index.js'

export default async function adminRoutes(app) {
  app.addHook('preHandler', async (req, reply) => {
    try {
      await req.jwtVerify()
      const { rows } = await pool.query('SELECT is_admin FROM users WHERE id = $1', [req.user.id])
      if (!rows.length || !rows[0].is_admin) {
        return reply.code(403).send({ error: 'Access denied: Admin only' })
      }
    } catch (e) {
      return reply.code(401).send({ error: 'Unauthorized' })
    }
  })

  app.get('/users', async () => {
    const { rows } = await pool.query(
      `SELECT id, username, display_name, avatar_color, avatar_object_key, avatar_mime_type, public_key, is_admin,
              CASE WHEN COALESCE(last_seen, NOW() - INTERVAL '1 day') > NOW() - INTERVAL '70 seconds' THEN true ELSE false END AS online,
              last_seen, created_at
       FROM users ORDER BY created_at DESC`
    )
    return rows
  })

  app.get('/stats', async () => {
    const [{ rows: usersRows }, { rows: chatsRows }, { rows: messagesRows }, { rows: onlineRows }, { rows: adminsRows }] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS count FROM users'),
      pool.query('SELECT COUNT(*)::int AS count FROM chats'),
      pool.query('SELECT COUNT(*)::int AS count FROM messages'),
      pool.query(`SELECT COUNT(*)::int AS count FROM users WHERE COALESCE(last_seen, NOW() - INTERVAL '1 day') > NOW() - INTERVAL '70 seconds'`),
      pool.query('SELECT COUNT(*)::int AS count FROM users WHERE is_admin = true'),
    ])
    return {
      users: usersRows[0]?.count || 0,
      chats: chatsRows[0]?.count || 0,
      messages: messagesRows[0]?.count || 0,
      online: onlineRows[0]?.count || 0,
      admins: adminsRows[0]?.count || 0,
    }
  })

  app.delete('/users/:id', async (req, reply) => {
    const id = String(req.params.id)
    if (id === String(req.user.id)) return reply.code(400).send({ error: 'You cannot delete yourself' })

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const exists = await client.query('SELECT id FROM users WHERE id = $1', [id])
      if (!exists.rows.length) {
        await client.query('ROLLBACK')
        return reply.code(404).send({ error: 'Пользователь не найден' })
      }

      const tableExists = async (name) => {
        const { rows } = await client.query('SELECT to_regclass($1) AS reg', [`public.${name}`])
        return Boolean(rows[0]?.reg)
      }

      if (await tableExists('message_reactions')) {
        await client.query('DELETE FROM message_reactions WHERE user_id = $1', [id])
        await client.query('DELETE FROM message_reactions WHERE message_id IN (SELECT id FROM messages WHERE sender_id = $1)', [id])
      }
      if (await tableExists('messages')) {
        // First detach session keys to satisfy FK in older schemas
        if (await tableExists('session_keys')) {
          await client.query(
            `UPDATE messages SET session_key_id = NULL
             WHERE session_key_id IN (SELECT id FROM session_keys WHERE user_id = $1)`,
            [id]
          )
        }
        await client.query('DELETE FROM messages WHERE sender_id = $1', [id])
      }
      if (await tableExists('call_signals')) {
        await client.query('DELETE FROM call_signals WHERE from_id = $1 OR target_id = $1', [id])
      }
      if (await tableExists('push_subscriptions')) {
        await client.query('DELETE FROM push_subscriptions WHERE user_id = $1', [id])
      }
      if (await tableExists('session_keys')) {
        await client.query('DELETE FROM session_keys WHERE user_id = $1', [id])
      }
      if (await tableExists('files')) {
        await client.query('DELETE FROM files WHERE uploader_id = $1', [id])
      }
      if (await tableExists('chat_members')) {
        await client.query('DELETE FROM chat_members WHERE user_id = $1', [id])
      }
      await client.query('DELETE FROM users WHERE id = $1', [id])
      await client.query(`DELETE FROM chats c
        WHERE NOT EXISTS (
          SELECT 1 FROM chat_members cm WHERE cm.chat_id = c.id
        )`)
      await client.query('COMMIT')
      return { ok: true }
    } catch (e) {
      await client.query('ROLLBACK')
      req.log.error(e)
      return reply.code(500).send({ error: e.message || 'Не удалось удалить пользователя', detail: e.detail, constraint: e.constraint })
    } finally {
      client.release()
    }
  })

  app.post('/users/:id/promote', async (req) => {
    const { id } = req.params
    await pool.query('UPDATE users SET is_admin = true WHERE id = $1', [id])
    return { ok: true }
  })
}
