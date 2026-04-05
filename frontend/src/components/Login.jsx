import React, { useState } from 'react'
import { generateKeyPair, encryptKeyWithPassword, decryptKeyWithPassword } from '../crypto/e2e.js'
import QRScanner from './QRScanner.jsx'
import { Lock, QrCode, MessageCircleMore, ShieldCheck, ServerCog } from 'lucide-react'

export default function Login({ onLogin, serverUrl = '', onOpenServerSettings }) {
  const [isRegister, setIsRegister] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showScanner, setShowScanner] = useState(false)

  const handleQRScan = async (data) => {
    try {
      const parsed = typeof data === 'string' ? JSON.parse(data) : data
      if (parsed.t && parsed.u && parsed.k) {
         localStorage.setItem('token', parsed.t)
         localStorage.setItem('user', JSON.stringify(parsed.u))
         localStorage.setItem(`chatik_sk_${parsed.u.id}`, parsed.k)
         try {
           const meRes = await fetch('/api/users/me', { headers: { Authorization: `Bearer ${parsed.t}` } })
           if (meRes.ok) {
             const me = await meRes.json()
             localStorage.setItem('user', JSON.stringify(me))
             onLogin(parsed.t, me)
           } else {
             onLogin(parsed.t, parsed.u)
           }
         } catch {
           onLogin(parsed.t, parsed.u)
         }
      } else {
         alert('Некорректный QR-код')
      }
    } catch (e) {
      alert('Ошибка при чтении QR-кода')
    }
    setShowScanner(false)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    
    try {
      let endpoint = isRegister ? '/api/auth/register' : '/api/auth/login'
      let body = { username, password }
      let keys = null

      if (isRegister) {
        keys = generateKeyPair()
        body.display_name = displayName
        body.public_key = keys.publicKey
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Ошибка входа')

      if (isRegister) {
        const oldKeys = Object.keys(localStorage).filter(k => k.startsWith('chatik_'))
        oldKeys.forEach(k => localStorage.removeItem(k))
        localStorage.removeItem('token')
        localStorage.removeItem('user')
        localStorage.setItem(`chatik_sk_${data.user.id}`, keys.secretKey)
        const encryptedBackup = await encryptKeyWithPassword(keys.secretKey, password)
        await fetch('/api/users/me/key-backup', {
           method: 'PUT',
           headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.token}` },
           body: JSON.stringify({ encrypted_secret_key: encryptedBackup })
        })
      } else if (!localStorage.getItem(`chatik_sk_${data.user.id}`) && data.user.encrypted_secret_key) {
        const recovered = await decryptKeyWithPassword(data.user.encrypted_secret_key, password)
        if (recovered) {
          localStorage.setItem(`chatik_sk_${data.user.id}`, recovered)
        }
      } else if (!localStorage.getItem(`chatik_sk_${data.user.id}`) && !data.user.encrypted_secret_key) {
        // Старые аккаунты без ключей: создаем новый ключ и сохраняем на сервере
        const fresh = generateKeyPair()
        localStorage.setItem(`chatik_sk_${data.user.id}`, fresh.secretKey)
        const encryptedBackup = await encryptKeyWithPassword(fresh.secretKey, password)
        await fetch('/api/users/me/keys', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.token}` },
          body: JSON.stringify({ public_key: fresh.publicKey, encrypted_secret_key: encryptedBackup })
        })
        const meRes = await fetch('/api/users/me', { headers: { Authorization: `Bearer ${data.token}` } })
        if (meRes.ok) {
          const me = await meRes.json()
          onLogin(data.token, me)
          return
        }
      } else if (localStorage.getItem(`chatik_sk_${data.user.id}`) && !data.user.encrypted_secret_key) {
        // Есть локальный ключ, но нет резервной копии — создаем бэкап
        const localKey = localStorage.getItem(`chatik_sk_${data.user.id}`)
        if (localKey) {
          const encryptedBackup = await encryptKeyWithPassword(localKey, password)
          await fetch('/api/users/me/key-backup', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.token}` },
            body: JSON.stringify({ encrypted_secret_key: encryptedBackup })
          })
        }
      }

      onLogin(data.token, data.user)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-screen">
      <div className="login-box glass login-card">
        <div className="login-brand">
          <div className="brand-badge"><MessageCircleMore size={28} /></div>
          <h1>chat-iK</h1>
          <p>Безопасные переписки и вход по QR</p>
          {!!serverUrl && (
            <div className="server-chip">Сервер: {serverUrl}</div>
          )}
        </div>

        <div className="login-pills">
          <div className="login-pill"><ShieldCheck size={16} /> Сквозное шифрование</div>
          <div className="login-pill"><Lock size={16} /> Локальное хранение ключа</div>
        </div>

        {error && <div className="login-error">{error}</div>}

        <form onSubmit={handleSubmit} className="login-form">
          {isRegister && (
            <input 
              type="text" 
              className="input" 
              placeholder="Имя в чате" 
              value={displayName} 
              onChange={e => setDisplayName(e.target.value)} 
              required
            />
          )}
          <input 
            type="text" 
            className="input" 
            placeholder="Логин" 
            value={username} 
            onChange={e => setUsername(e.target.value)} 
            autoComplete="username"
            required 
          />
          <input 
            type="password" 
            className="input" 
            placeholder="Пароль" 
            value={password} 
            onChange={e => setPassword(e.target.value)} 
            autoComplete={isRegister ? 'new-password' : 'current-password'}
            required 
          />

          <button type="submit" className="btn login-submit" disabled={loading}>
            {loading ? 'Вход...' : (isRegister ? 'Создать аккаунт' : 'Войти')}
          </button>
        </form>

        <div className="login-actions">
          <button 
            type="button" 
            onClick={() => setIsRegister(!isRegister)} 
            className="text-action"
          >
            {isRegister ? 'Уже есть аккаунт? Войти' : 'Нет аккаунта? Зарегистрироваться'}
          </button>

          {!isRegister && !showScanner && (
            <button 
              type="button" 
              onClick={() => setShowScanner(true)} 
              className="qr-login-btn"
            >
              <QrCode size={18} /> Войти по QR-коду
            </button>
          )}
          {!!onOpenServerSettings && (
            <button type="button" className="text-action server-action-btn" onClick={onOpenServerSettings}>
              <ServerCog size={16} /> Сменить адрес сервера
            </button>
          )}

          {showScanner && (
             <QRScanner 
               onScan={handleQRScan} 
               onClose={() => setShowScanner(false)} 
             />
          )}
        </div>
      </div>
    </div>
  )
}
