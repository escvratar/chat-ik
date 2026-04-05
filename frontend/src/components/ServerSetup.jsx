import React, { useState } from 'react'
import { Server, CheckCircle2 } from 'lucide-react'
import { normalizeServerUrl } from '../utils/serverConfig.js'

export default function ServerSetup({ initialValue = '', onSave }) {
  const [value, setValue] = useState(initialValue || '')
  const [error, setError] = useState('')

  const submit = (e) => {
    e.preventDefault()
    const normalized = normalizeServerUrl(value)
    if (!normalized) {
      setError('Введите корректный адрес сервера')
      return
    }
    setError('')
    onSave?.(normalized)
  }

  return (
    <div className="login-screen">
      <div className="login-box glass login-card">
        <div className="login-brand">
          <div className="brand-badge"><Server size={28} /></div>
          <h1>Подключение</h1>
          <p>Введите адрес вашего сервера chat-iK</p>
        </div>

        {error && <div className="login-error">{error}</div>}

        <form onSubmit={submit} className="login-form">
          <input
            className="input"
            type="text"
            placeholder="https://chat.example.com"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <button type="submit" className="btn login-submit">
            <CheckCircle2 size={18} /> Сохранить и войти
          </button>
        </form>
      </div>
    </div>
  )
}

