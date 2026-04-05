import { pool, sendPushNotification } from '../index.js'

function normalizeChatRow(row) {
  if (!row) return null
  return {
    ...row,
    partner: row.is_group ? null : {
      id: row.partner_id,
      username: row.partner_username,
      display_name: row.partner_name,
      avatar_color: row.partner_color,
      avatar_object_key: row.partner_avatar_key,
      avatar_mime_type: row.partner_avatar_mime,
      public_key: row.partner_public_key,
      online: row.partner_online,
      last_seen: row.partner_last_seen,
    },
  }
}

const onlineExpr = `CASE WHEN COALESCE(u.last_seen, NOW() - INTERVAL '1 day') > NOW() - INTERVAL '70 seconds' THEN true ELSE false END`

async function getReactionsMap(messageIds, userId) {
  if (!messageIds.length) return new Map()
  const { rows } = await pool.query(
    `SELECT message_id, emoji, COUNT(*)::int AS count,
            BOOL_OR(user_id = $1) AS mine
     FROM message_reactions
     WHERE message_id = ANY($2::uuid[])
     GROUP BY message_id, emoji`,
    [userId, messageIds]
  )
  const map = new Map()
  for (const row of rows) {
    const current = map.get(row.message_id) || []
    current.push({ emoji: row.emoji, count: row.count, mine: row.mine })
    map.set(row.message_id, current)
  }
  return map
}

async function createMessageRecord({ chatId, userId, encryptedContent, messageType = 'text', fileId = null, sessionKeyId = null, clientId = null }) {
  const { rows: mem } = await pool.query(
    'SELECT 1 FROM chat_members WHERE chat_id=$1 AND user_id=$2',
    [chatId, userId]
  )
  if (!mem.length) {
    const err = new Error('Forbidden')
    err.statusCode = 403
    throw err
  }

  const { rows: senderRows } = await pool.query(
    'SELECT display_name FROM users WHERE id=$1',
    [userId]
  )

  const { rows } = await pool.query(`
    INSERT INTO messages (chat_id, sender_id, encrypted_content, message_type, file_id, session_key_id)
    VALUES ($1,$2,$3,$4,$5,$6)
    RETURNING id, chat_id, sender_id, encrypted_content, message_type, file_id, session_key_id, status, created_at
  `, [chatId, userId, encryptedContent, messageType || 'text', fileId || null, sessionKeyId || null])

  return {
    ...rows[0],
    sender_name: senderRows[0]?.display_name || 'Anonymous',
    client_id: clientId,
    reactions: [],
  }
}

async function getChatById(chatId, userId) {
  const { rows } = await pool.query(`
    SELECT
      c.id,
      c.created_at,
      COALESCE(c.is_group, false) AS is_group,
      c.name AS group_name,
      u.id AS partner_id,
      u.username AS partner_username,
      u.display_name AS partner_name,
      u.avatar_color AS partner_color,
      u.avatar_object_key AS partner_avatar_key,
      u.avatar_mime_type AS partner_avatar_mime,
      u.public_key AS partner_public_key,
      ${onlineExpr} AS partner_online,
      u.last_seen AS partner_last_seen,
      m.encrypted_content AS last_message,
      m.message_type AS last_message_type,
      m.sender_id AS last_sender_id,
      m.created_at AS last_message_at,
      m.status AS last_status,
      (
        SELECT COUNT(*)
        FROM messages um
        WHERE um.chat_id = c.id
          AND um.sender_id != $1
          AND COALESCE(um.status, 'sent') != 'read'
      )::int AS unread_count
    FROM chats c
    JOIN chat_members cm1 ON cm1.chat_id = c.id AND cm1.user_id = $1
    LEFT JOIN chat_members cm2 ON cm2.chat_id = c.id AND cm2.user_id != $1 AND COALESCE(c.is_group, false) = false
    LEFT JOIN users u ON u.id = cm2.user_id
    LEFT JOIN LATERAL (
      SELECT encrypted_content, message_type, sender_id, created_at, status
      FROM messages WHERE chat_id = c.id
      ORDER BY created_at DESC LIMIT 1
    ) m ON true
    WHERE c.id = $2
    LIMIT 1
  `, [userId, chatId])
  return normalizeChatRow(rows[0])
}

export default async function chatRoutes(app) {
  // GET /api/chats — list all chats for current user
  app.get('/', { preHandler: [app.authenticate] }, async (req) => {
    const { rows } = await pool.query(`
      SELECT
        c.id,
        c.created_at,
        COALESCE(c.is_group, false) AS is_group,
        c.name AS group_name,
        -- For 1:1 chats, get partner info
        u.id AS partner_id,
        u.username AS partner_username,
        u.display_name AS partner_name,
        u.avatar_color AS partner_color,
        u.avatar_object_key AS partner_avatar_key,
        u.avatar_mime_type AS partner_avatar_mime,
        u.public_key AS partner_public_key,
        ${onlineExpr} AS partner_online,
        u.last_seen AS partner_last_seen,
        -- Latest message info
        m.encrypted_content AS last_message,
        m.message_type AS last_message_type,
        m.sender_id AS last_sender_id,
        m.created_at AS last_message_at,
        m.status AS last_status,
        (
          SELECT COUNT(*)
          FROM messages um
          WHERE um.chat_id = c.id
            AND um.sender_id != $1
            AND COALESCE(um.status, 'sent') != 'read'
        )::int AS unread_count
      FROM chats c
      JOIN chat_members cm1 ON cm1.chat_id = c.id AND cm1.user_id = $1
      LEFT JOIN chat_members cm2 ON cm2.chat_id = c.id AND cm2.user_id != $1 AND COALESCE(c.is_group, false) = false
      LEFT JOIN users u ON u.id = cm2.user_id
      LEFT JOIN LATERAL (
        SELECT encrypted_content, message_type, sender_id, created_at, status
        FROM messages WHERE chat_id = c.id
        ORDER BY created_at DESC LIMIT 1
      ) m ON true
      WHERE COALESCE(c.is_group, false) = true OR u.id IS NOT NULL
      ORDER BY COALESCE(m.created_at, c.created_at) DESC
    `, [req.user.id])
    return rows
  })

  // POST /api/chats — create 1:1 or group chat
  app.post('/', { preHandler: [app.authenticate] }, async (req, reply) => {
    try {
      const { partner_id, member_ids, name, is_group } = req.body || {}

    // ── Group Chat logic ──────────────────────────────────────────────────
    if (is_group) {
        if (!name || !member_ids || !Array.isArray(member_ids)) {
            return reply.code(400).send({ error: 'Group needs name and member_ids' })
        }
        const { rows } = await pool.query('INSERT INTO chats (name, is_group) VALUES ($1, true) RETURNING id', [name])
        const chatId = rows[0].id
        
        // Add all members + current user
        const allMembers = [...new Set([...member_ids, req.user.id])]
        const values = allMembers.map((uid, idx) => `($1, $${idx + 2})`).join(',')
        await pool.query(
            `INSERT INTO chat_members (chat_id, user_id) VALUES ${values}`,
            [chatId, ...allMembers]
        )
        const chat = await getChatById(chatId, req.user.id)
        return { chat_id: chatId, chat }
    }

    // ── 1:1 Chat logic ────────────────────────────────────────────────────
    if (!partner_id) return reply.code(400).send({ error: 'Missing partner_id' })

    const { rows: existing } = await pool.query(`
      SELECT c.id FROM chats c
      JOIN chat_members cm1 ON cm1.chat_id = c.id AND cm1.user_id = $1
      JOIN chat_members cm2 ON cm2.chat_id = c.id AND cm2.user_id = $2
      WHERE COALESCE(c.is_group, false) = false
    `, [req.user.id, partner_id])

    if (existing.length) {
      const chat = await getChatById(existing[0].id, req.user.id)
      return { chat_id: existing[0].id, chat }
    }

    const { rows } = await pool.query('INSERT INTO chats (is_group) VALUES (false) RETURNING id')
    const chatId = rows[0].id
    await pool.query(
      'INSERT INTO chat_members (chat_id, user_id) VALUES ($1,$2),($1,$3)',
      [chatId, req.user.id, partner_id]
    )
    const chat = await getChatById(chatId, req.user.id)
    return { chat_id: chatId, chat }
    } catch (e) {
      req.log.error(e)
      return reply.code(500).send({ error: 'Не удалось открыть чат' })
    }
  })

  // GET /api/chats/:id/messages
  app.get('/:id/messages', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { rows: mem } = await pool.query(
      'SELECT 1 FROM chat_members WHERE chat_id=$1 AND user_id=$2',
      [req.params.id, req.user.id]
    )
    if (!mem.length) return reply.code(403).send({ error: 'Forbidden' })

    const limit = Math.min(parseInt(req.query.limit || '50'), 100)
    const before = req.query.before || new Date().toISOString()

    const { rows } = await pool.query(`
      SELECT m.id, m.chat_id, m.sender_id, m.encrypted_content,
             m.message_type, m.file_id, m.session_key_id, m.status, m.created_at, m.edited_at,
             u.display_name AS sender_name, u.avatar_color AS sender_color
      FROM messages m
      LEFT JOIN users u ON u.id = m.sender_id
      WHERE m.chat_id = $1 AND m.created_at < $2
      ORDER BY m.created_at DESC
      LIMIT $3
    `, [req.params.id, before, limit])
    const reversed = rows.reverse()
    const reactionMap = await getReactionsMap(reversed.map(r => r.id), req.user.id)
    return reversed.map(row => ({ ...row, reactions: reactionMap.get(row.id) || [] }))
  })

  // GET /api/chats/:id/messages/since?after=ISO&limit=...
  app.get('/:id/messages/since', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { rows: mem } = await pool.query(
      'SELECT 1 FROM chat_members WHERE chat_id=$1 AND user_id=$2',
      [req.params.id, req.user.id]
    )
    if (!mem.length) return reply.code(403).send({ error: 'Forbidden' })

    const after = req.query.after || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const limit = Math.min(parseInt(req.query.limit || '120'), 200)

    const { rows } = await pool.query(
      `SELECT m.id, m.chat_id, m.sender_id, m.encrypted_content,
              m.message_type, m.file_id, m.session_key_id, m.status, m.created_at, m.edited_at,
              u.display_name AS sender_name, u.avatar_color AS sender_color
       FROM messages m
       LEFT JOIN users u ON u.id = m.sender_id
       WHERE m.chat_id = $1 AND m.created_at > $2
       ORDER BY m.created_at ASC
       LIMIT $3`,
      [req.params.id, after, limit]
    )
    const reactionMap = await getReactionsMap(rows.map(r => r.id), req.user.id)
    return rows.map(row => ({ ...row, reactions: reactionMap.get(row.id) || [] }))
  })

  // POST /api/chats/:id/messages — fallback message send without WebSocket
  app.post('/:id/messages', { preHandler: [app.authenticate] }, async (req, reply) => {
    try {
      const { encrypted_content, message_type, file_id, session_key_id, client_id } = req.body || {}
      if (!encrypted_content) return reply.code(400).send({ error: 'Missing encrypted_content' })

      const message = await createMessageRecord({
        chatId: req.params.id,
        userId: req.user.id,
        encryptedContent: encrypted_content,
        messageType: message_type || 'text',
        fileId: file_id || null,
        sessionKeyId: session_key_id || null,
        clientId: client_id || null,
      })

      try {
        const { rows: members } = await pool.query(
          `SELECT cm.user_id, u.display_name
           FROM chat_members cm
           JOIN users u ON u.id = cm.user_id
           WHERE cm.chat_id = $1 AND cm.user_id != $2`,
          [req.params.id, req.user.id]
        )
        for (const member of members) {
          sendPushNotification(
            member.user_id,
            message.sender_name || 'Новое сообщение',
            message_type === 'file' ? '📁 Файл' : 'Новое сообщение',
            '/',
            { sender_id: req.user.id, chat_id: req.params.id, type: 'message' }
          )
        }
      } catch {}

      return { ok: true, message }
    } catch (e) {
      req.log.error(e)
      const code = e.statusCode || 500
      return reply.code(code).send({ error: code === 403 ? 'Forbidden' : 'Не удалось отправить сообщение' })
    }
  })

  // PATCH /api/chats/:chatId/messages/:msgId — edit own text message
  app.patch('/:chatId/messages/:msgId', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { encrypted_content } = req.body || {}
    if (!encrypted_content) return reply.code(400).send({ error: 'Missing content' })
    const { rows: mem } = await pool.query(
      'SELECT 1 FROM chat_members WHERE chat_id=$1 AND user_id=$2',
      [req.params.chatId, req.user.id]
    )
    if (!mem.length) return reply.code(403).send({ error: 'Forbidden' })

    const { rows } = await pool.query(
      `UPDATE messages
       SET encrypted_content = $1, edited_at = NOW()
       WHERE id = $2 AND chat_id = $3 AND sender_id = $4 AND message_type = 'text'
       RETURNING id, chat_id, sender_id, encrypted_content, message_type, file_id, session_key_id, status, created_at, edited_at`,
      [encrypted_content, req.params.msgId, req.params.chatId, req.user.id]
    )
    if (!rows.length) return reply.code(404).send({ error: 'Не найдено' })
    return { ok: true, message: rows[0] }
  })

  // DELETE /api/chats/:chatId/messages/:msgId — delete own message
  app.delete('/:chatId/messages/:msgId', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { rows: mem } = await pool.query(
      'SELECT 1 FROM chat_members WHERE chat_id=$1 AND user_id=$2',
      [req.params.chatId, req.user.id]
    )
    if (!mem.length) return reply.code(403).send({ error: 'Forbidden' })

    const { rows } = await pool.query(
      'DELETE FROM messages WHERE id = $1 AND chat_id = $2 AND sender_id = $3 RETURNING id',
      [req.params.msgId, req.params.chatId, req.user.id]
    )
    if (!rows.length) return reply.code(404).send({ error: 'Не найдено' })
    return { ok: true }
  })

  // POST /api/chats/:chatId/messages/:msgId/reactions — toggle reaction
  app.post('/:chatId/messages/:msgId/reactions', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { emoji } = req.body || {}
    if (!emoji) return reply.code(400).send({ error: 'Missing emoji' })
    const { rows: mem } = await pool.query(
      'SELECT 1 FROM chat_members WHERE chat_id=$1 AND user_id=$2',
      [req.params.chatId, req.user.id]
    )
    if (!mem.length) return reply.code(403).send({ error: 'Forbidden' })

    const exists = await pool.query(
      'SELECT 1 FROM message_reactions WHERE message_id=$1 AND user_id=$2 AND emoji=$3',
      [req.params.msgId, req.user.id, emoji]
    )
    if (exists.rows.length) {
      await pool.query(
        'DELETE FROM message_reactions WHERE message_id=$1 AND user_id=$2 AND emoji=$3',
        [req.params.msgId, req.user.id, emoji]
      )
    } else {
      await pool.query(
        'INSERT INTO message_reactions (message_id, user_id, emoji) VALUES ($1,$2,$3)',
        [req.params.msgId, req.user.id, emoji]
      )
    }

    const reactionMap = await getReactionsMap([req.params.msgId], req.user.id)
    return { ok: true, reactions: reactionMap.get(req.params.msgId) || [] }
  })

  // GET /api/chats/:id/members — list all group members
  app.get('/:id/members', { preHandler: [app.authenticate] }, async (req) => {
    const { rows } = await pool.query(`
        SELECT u.id, u.username, u.display_name, u.avatar_color, u.avatar_object_key, u.avatar_mime_type,
               CASE WHEN COALESCE(u.last_seen, NOW() - INTERVAL '1 day') > NOW() - INTERVAL '70 seconds' THEN true ELSE false END AS online,
               u.public_key
        FROM users u
        JOIN chat_members cm ON cm.user_id = u.id
        WHERE cm.chat_id = $1
    `, [req.params.id])
    return rows
  })

  app.post('/:id/read', { preHandler: [app.authenticate] }, async (req) => {
    const ids = Array.isArray(req.body?.message_ids) ? req.body.message_ids : []
    if (!ids.length) return { ok: true, updated: [] }

    const { rows } = await pool.query(
      `UPDATE messages SET status='read'
       WHERE chat_id=$1 AND id = ANY($2::uuid[]) AND sender_id != $3
       RETURNING id`,
      [req.params.id, ids, req.user.id]
    )
    return { ok: true, updated: rows.map(row => row.id) }
  })

  // PATCH /api/chats/:chatId/messages/:msgId/read
  app.patch('/:chatId/messages/:msgId/read', { preHandler: [app.authenticate] }, async (req) => {
    await pool.query(
      `UPDATE messages SET status='read'
       WHERE chat_id=$1 AND id=$2 AND sender_id != $3`,
      [req.params.chatId, req.params.msgId, req.user.id]
    )
    return { ok: true }
  })

  // DELETE /api/chats/:id/clear
  app.delete('/:id/clear', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { rows: mem } = await pool.query(
      'SELECT 1 FROM chat_members WHERE chat_id=$1 AND user_id=$2',
      [req.params.id, req.user.id]
    )
    if (!mem.length) return reply.code(403).send({ error: 'Forbidden' })

    await pool.query('DELETE FROM messages WHERE chat_id=$1', [req.params.id])
    return { ok: true }
  })

  // DELETE /api/chats/:id — delete group chat (only group)
  app.delete('/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { rows: chatRows } = await pool.query(
      'SELECT id, is_group FROM chats WHERE id = $1',
      [req.params.id]
    )
    if (!chatRows.length) return reply.code(404).send({ error: 'Не найдено' })
    if (!chatRows[0].is_group) return reply.code(400).send({ error: 'Нельзя удалить личный чат' })

    const { rows: mem } = await pool.query(
      'SELECT 1 FROM chat_members WHERE chat_id=$1 AND user_id=$2',
      [req.params.id, req.user.id]
    )
    if (!mem.length) return reply.code(403).send({ error: 'Forbidden' })

    await pool.query('DELETE FROM chats WHERE id = $1', [req.params.id])
    return { ok: true }
  })
}
