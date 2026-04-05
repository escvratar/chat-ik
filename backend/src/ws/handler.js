import { pool, sendPushNotification } from '../index.js'
import { randomUUID } from 'crypto'

const clients = new Map() // userId -> Set of sockets

export default function wsHandler(socket, req) {
  let userId = null

  socket.on('message', async (data) => {
    try {
      const msg = JSON.parse(data)

      if (msg.type === 'auth') {
        try {
          const payload = await req.server.jwt.verify(msg.token)
          userId = payload.id
          
          if (!clients.has(userId)) clients.set(userId, new Set())
          clients.get(userId).add(socket)
          
          socket.send(JSON.stringify({ type: 'auth_success' }))
          broadcastToAll({ type: 'presence', user_id: userId, online: true })
          
          await pool.query('UPDATE users SET online=true, last_seen=NOW() WHERE id=$1', [userId])
        } catch (e) {
          socket.close()
        }
        return
      }

      if (!userId) return

      // ── Handle Messages ───────────────────────────────────────────────────
      if (msg.type === 'message') {
        const { chat_id, encrypted_content, message_type, file_id, session_key_id, client_id } = msg
        try {
          const msgId = randomUUID()
          const { rows: senderRows } = await pool.query('SELECT display_name FROM users WHERE id=$1', [userId])
          const senderName = senderRows[0]?.display_name || 'Anonymous'

          await pool.query(
            `INSERT INTO messages (id,chat_id,sender_id,encrypted_content,message_type,file_id,session_key_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [msgId, chat_id, userId, encrypted_content, message_type || 'text', file_id || null, session_key_id || null]
          )
          
          const payload = {
            type: 'message', id: msgId, chat_id, sender_id: userId, sender_name: senderName,
            encrypted_content, message_type: message_type || 'text', file_id: file_id || null,
            session_key_id: session_key_id || null, client_id: client_id || null,
            status: 'sent', created_at: new Date().toISOString()
          }

          broadcast(userId, payload)
          const members = await getChatMembers(chat_id, userId)
          
          for (const m of members) {
            const delivered = broadcast(m.user_id, { ...payload, is_group: m.is_group, group_name: m.group_name })
            if (!delivered) {
              sendPushNotification(
                m.user_id,
                senderName,
                message_type === 'file' ? '📁 Файл' : 'Новое сообщение',
                '/',
                { sender_id: userId, chat_id, type: 'message' }
              )
            }
          }
        } catch (dbErr) { console.error('DB Message Error:', dbErr) }
        return
      }

      // ── Handle Read Status ───────────────────────────────────────────────
      if (msg.type === 'read') {
        await pool.query(`UPDATE messages SET status='read' WHERE id=ANY($1::uuid[]) AND sender_id!=$2`, [msg.message_ids, userId])
        const members = await getChatMembers(msg.chat_id, userId)
        for (const m of members) broadcast(m.user_id, { type: 'read', chat_id: msg.chat_id, message_ids: msg.message_ids })
        return
      }

      // ── Handle Typing ────────────────────────────────────────────────────
      if (msg.type === 'typing') {
        const members = await getChatMembers(msg.chat_id, userId)
        for (const m of members) broadcast(m.user_id, {
          type: 'typing',
          chat_id: msg.chat_id,
          user_id: userId,
          is_typing: msg.is_typing,
          kind: msg.kind || 'typing',
          user_name: msg.user_name || null,
        })
        return
      }

      if (msg.type === 'reaction') {
        const { chat_id, message_id, emoji } = msg
        if (!chat_id || !message_id || !emoji) return
        try {
          const exists = await pool.query(
            'SELECT 1 FROM message_reactions WHERE message_id=$1 AND user_id=$2 AND emoji=$3',
            [message_id, userId, emoji]
          )
          if (exists.rows.length) {
            await pool.query(
              'DELETE FROM message_reactions WHERE message_id=$1 AND user_id=$2 AND emoji=$3',
              [message_id, userId, emoji]
            )
          } else {
            await pool.query(
              'INSERT INTO message_reactions (message_id, user_id, emoji) VALUES ($1,$2,$3)',
              [message_id, userId, emoji]
            )
          }
          const { rows } = await pool.query(
            `SELECT emoji, COUNT(*)::int AS count, BOOL_OR(user_id = $2) AS mine
             FROM message_reactions
             WHERE message_id = $1
             GROUP BY emoji`,
            [message_id, userId]
          )
          const members = await getChatMembers(chat_id, userId)
          for (const m of members) {
            broadcast(m.user_id, {
              type: 'reaction',
              chat_id,
              message_id,
              reactions: rows,
            })
          }
          broadcast(userId, {
            type: 'reaction',
            chat_id,
            message_id,
            reactions: rows,
          })
        } catch (err) {
          console.error('Reaction error:', err)
        }
        return
      }

      // ── Handle Signaling ─────────────────────────────────────────────────
      if (['call:offer', 'call:answer', 'call:ice', 'call:end', 'call:reject'].includes(msg.type)) {
        if (!msg.target_id) return
        const delivered = broadcast(msg.target_id, { ...msg, from_id: userId })
        if (!delivered && msg.type === 'call:offer') {
          try {
            const { rows: senderRows } = await pool.query('SELECT display_name FROM users WHERE id=$1', [userId])
            const senderName = senderRows[0]?.display_name || 'Пользователь'
            sendPushNotification(msg.target_id, 'Входящий звонок', `${senderName} звонит вам`, '/', { sender_id: userId, type: 'call' })
          } catch {}
        }
        return
      }
    } catch (err) { console.error('WS Message Parse Error:', err) }
  })

  socket.on('close', async () => {
    if (!userId) return
    const conns = clients.get(userId)
    if (conns) {
      conns.delete(socket)
      if (conns.size === 0) {
        clients.delete(userId)
        broadcastToAll({ type: 'presence', user_id: userId, online: false })
        await pool.query('UPDATE users SET online=false, last_seen=NOW() WHERE id=$1', [userId])
      }
    }
  })
}

function broadcast(userId, msg) {
  const conns = clients.get(userId)
  if (!conns || conns.size === 0) return false
  const data = JSON.stringify(msg)
  let sent = false
  for (const s of conns) {
    if (s.readyState === 1) {
      s.send(data)
      sent = true
    }
  }
  return sent
}

function broadcastToAll(msg) {
  const data = JSON.stringify(msg)
  for (const conns of clients.values()) {
    for (const s of conns) {
      if (s.readyState === 1) s.send(data)
    }
  }
}

async function getChatMembers(chatId, excludeUserId) {
  try {
    // 1. Try to get from chat_members (preferred)
    const { rows } = await pool.query(
      `SELECT cm.user_id, u.display_name, c.is_group, c.name as group_name 
       FROM chat_members cm 
       JOIN users u ON u.id = cm.user_id
       JOIN chats c ON c.id = cm.chat_id
       WHERE cm.chat_id=$1 AND cm.user_id!=$2`,
      [chatId, excludeUserId]
    )
    
    // 2. If no members found and it's a 1:1 chat, try to recover (old schema support)
    // Actually, normally chats should be migrated, but this is a safety net.
    return rows
  } catch (e) {
    console.error(`❌ DB Error in getChatMembers (chat: ${chatId}):`, e.message);
    return []
  }
}
