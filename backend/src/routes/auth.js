import bcrypt from 'bcrypt'
import svgCaptcha from 'svg-captcha'
import { randomUUID } from 'crypto'
import { pool } from '../index.js'

const captchaStore = new Map()
const buildAvatarUrl = (user) => user?.avatar_object_key ? `/api/users/${user.id}/avatar?v=${encodeURIComponent(user.avatar_object_key)}` : null

export default async function authRoutes(app) {
  // GET /api/auth/captcha
  app.get('/captcha', async (req, reply) => {
    const captcha = svgCaptcha.create({
      size: 6,
      ignoreChars: '0o1il',
      noise: 2,
      color: true,
      background: '#1a1b26'
    })
    const id = randomUUID()
    captchaStore.set(id, { text: captcha.text.toLowerCase(), expires: Date.now() + 5*60000 })
    
    // Cleanup old captchas
    for (const [k, v] of captchaStore.entries()) {
      if (Date.now() > v.expires) captchaStore.delete(k)
    }

    return { id, svg: captcha.data }
  })

  // POST /api/auth/register
  app.post('/register', async (req, reply) => {
    const { username, password, display_name, public_key } = req.body
    if (!username || !password || !display_name || !public_key)
      return reply.code(400).send({ error: 'Заполните все поля' })

    const hash = await bcrypt.hash(password, 12)
    try {
      const { rows } = await pool.query(
        `INSERT INTO users (username, password_hash, display_name, public_key)
         VALUES ($1, $2, $3, $4) RETURNING id, username, display_name, public_key, avatar_color, avatar_object_key, avatar_mime_type, created_at`,
        [username.toLowerCase(), hash, display_name, public_key]
      )
      const user = rows[0]
      user.avatar_url = buildAvatarUrl(user)
      const token = app.jwt.sign({ id: user.id, username: user.username }, { expiresIn: '30d' })
      return { token, user }
    } catch (e) {
      if (e.code === '23505') return reply.code(409).send({ error: 'Имя пользователя уже занято' })
      throw e
    }
  })

  // POST /api/auth/login
  app.post('/login', async (req, reply) => {
    const { username, password } = req.body
    if (!username || !password) return reply.code(400).send({ error: 'Заполните все поля' })

    const { rows } = await pool.query(
      'SELECT * FROM users WHERE username = $1', [username.toLowerCase()]
    )
    if (!rows.length) return reply.code(401).send({ error: 'Неверный логин или пароль' })

    const user = rows[0]
    const valid = await bcrypt.compare(password, user.password_hash)
    if (!valid) return reply.code(401).send({ error: 'Неверный логин или пароль' })

    const token = app.jwt.sign({ id: user.id, username: user.username }, { expiresIn: '30d' })
    const { password_hash, ...safeUser } = user
    safeUser.avatar_url = buildAvatarUrl(safeUser)
    return { token, user: safeUser }
  })
}
