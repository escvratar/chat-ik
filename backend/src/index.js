import Fastify from 'fastify'
import websocket from '@fastify/websocket'
import multipart from '@fastify/multipart'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import staticPlugin from '@fastify/static'
import pg from 'pg'
import path from 'path'
import fs from 'fs/promises'
import { existsSync } from 'fs'
import { fileURLToPath } from 'url'
import webpush from 'web-push'
import * as Minio from 'minio'

// Routes
import authRoutes from './routes/auth.js'
import userRoutes from './routes/users.js'
import chatRoutes from './routes/chats.js'
import fileRoutes from './routes/files.js'
import adminRoutes from './routes/admin.js'
import wsHandler from './ws/handler.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = Fastify({ logger: true, bodyLimit: 1024 * 1024 * 1024 })
const isProd = process.env.NODE_ENV === 'production'

const requiredEnv = [
  'DB_HOST',
  'DB_USER',
  'DB_PASSWORD',
  'DB_NAME',
  'MINIO_HOST',
  'MINIO_ACCESS_KEY',
  'MINIO_SECRET_KEY',
  'JWT_SECRET',
  'VAPID_PUBLIC_KEY',
  'VAPID_PRIVATE_KEY',
  'VAPID_CONTACT_EMAIL',
]
for (const key of requiredEnv) {
  if (!process.env[key]) {
    throw new Error(`Missing required env var: ${key}`)
  }
}

// ── Database ────────────────────────────────────────────────────────────────
const { Pool } = pg
export const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME
})

// ── MinIO ───────────────────────────────────────────────────────────────────
export const BUCKET = process.env.MINIO_BUCKET || 'chatik'
export const minio = new Minio.Client({
  endPoint: process.env.MINIO_HOST || 'localhost',
  port: Number(process.env.MINIO_PORT || 9000),
  useSSL: String(process.env.MINIO_USE_SSL || 'false') === 'true',
  accessKey: process.env.MINIO_ACCESS_KEY,
  secretKey: process.env.MINIO_SECRET_KEY
})

// ── Web Push configuration ──────────────────────────────────────────────────
webpush.setVapidDetails(
  process.env.VAPID_CONTACT_EMAIL,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
)

export async function sendPushNotification(userId, title, body, url = '/', meta = {}) {
  try {
    const { rows } = await pool.query('SELECT subscription FROM push_subscriptions WHERE user_id=$1', [userId])
    const payload = JSON.stringify({ title, body, url, ...meta })
    for (const row of rows) {
      try {
        const subscription = typeof row.subscription === 'string'
          ? JSON.parse(row.subscription)
          : row.subscription
        await webpush.sendNotification(subscription, payload)
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          await pool.query('DELETE FROM push_subscriptions WHERE user_id=$1 AND subscription=$2', 
             [userId, row.subscription])
        }
      }
    }
  } catch (err) {
    console.error('Push error:', err)
  }
}

// ── Plugins & Decorators ────────────────────────────────────────────────────
app.register(cors)
app.register(jwt, { secret: process.env.JWT_SECRET })
app.register(multipart, {
  limits: {
    fileSize: 1024 * 1024 * 1024,
  }
})
app.register(websocket)

const publicDir = path.join(__dirname, 'public')
if (existsSync(publicDir)) {
  app.register(staticPlugin, { root: publicDir, prefix: '/public/' })
}

app.decorate('authenticate', async (req, reply) => {
  try {
    await req.jwtVerify()
  } catch (err) {
    reply.send(err)
  }
})

// ── Register Routes ─────────────────────────────────────────────────────────
// Using direct registration to avoid nested scope issues with prefixes
app.register(authRoutes, { prefix: '/api/auth' })
app.register(userRoutes, { prefix: '/api/users' })
app.register(chatRoutes, { prefix: '/api/chats' })
app.register(fileRoutes, { prefix: '/api/files' })
app.register(adminRoutes, { prefix: '/api/admin' })

app.get('/ws', { websocket: true }, wsHandler)
app.get('/api/ws', { websocket: true }, wsHandler)


async function runMigrations() {
  const schemaPath = path.join(__dirname, 'db', 'schema.sql')
  const schemaSql = await fs.readFile(schemaPath, 'utf8')
  await pool.query(schemaSql)

  const compatibilitySql = `
    ALTER TABLE chats ADD COLUMN IF NOT EXISTS name VARCHAR(100);
    ALTER TABLE chats ADD COLUMN IF NOT EXISTS is_group BOOLEAN DEFAULT false;
    ALTER TABLE chats ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

    ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_color VARCHAR(7) DEFAULT '#6c63ff';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_object_key TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_mime_type TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS public_key TEXT DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS encrypted_secret_key TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS online BOOLEAN DEFAULT false;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ DEFAULT NOW();
    ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

    ALTER TABLE messages ADD COLUMN IF NOT EXISTS message_type VARCHAR(20) DEFAULT 'text';
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS file_id UUID;
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS session_key_id UUID;
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'sent';
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;

    CREATE TABLE IF NOT EXISTS chat_members (
      chat_id UUID REFERENCES chats(id) ON DELETE CASCADE,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (chat_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS session_keys (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      public_key TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS files (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      uploader_id UUID REFERENCES users(id) ON DELETE SET NULL,
      object_key TEXT NOT NULL,
      original_name TEXT,
      mime_type TEXT,
      size_bytes BIGINT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS push_subscriptions (
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      subscription JSONB NOT NULL,
      PRIMARY KEY (user_id, subscription)
    );

    CREATE TABLE IF NOT EXISTS call_signals (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      from_id UUID REFERENCES users(id) ON DELETE CASCADE,
      target_id UUID REFERENCES users(id) ON DELETE CASCADE,
      signal_type VARCHAR(32) NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '5 minutes')
    );

    CREATE TABLE IF NOT EXISTS message_reactions (
      message_id UUID REFERENCES messages(id) ON DELETE CASCADE,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      emoji VARCHAR(16) NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (message_id, user_id, emoji)
    );

    CREATE TABLE IF NOT EXISTS user_contacts (
      owner_id UUID REFERENCES users(id) ON DELETE CASCADE,
      contact_id UUID REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (owner_id, contact_id),
      CHECK (owner_id <> contact_id)
    );

    CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id);
    CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
    CREATE INDEX IF NOT EXISTS idx_chat_members_user ON chat_members(user_id);
    CREATE INDEX IF NOT EXISTS idx_call_signals_target_created ON call_signals(target_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_message_reactions_message ON message_reactions(message_id);
    CREATE INDEX IF NOT EXISTS idx_user_contacts_owner ON user_contacts(owner_id);
  `
  await pool.query(compatibilitySql)
}

// ── Start Server ────────────────────────────────────────────────────────────
const start = async () => {
  try {
    await runMigrations()

    const exists = await minio.bucketExists(BUCKET).catch(() => false)
    if (!exists) await minio.makeBucket(BUCKET)

    await app.listen({ port: Number(process.env.PORT || 3000), host: '0.0.0.0' })
    if (!isProd) {
      console.log('Database connected & MinIO ready')
      console.log('chat-iK backend running')
    }
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}
start()
