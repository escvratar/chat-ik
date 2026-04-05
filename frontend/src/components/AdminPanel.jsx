import React, { useState, useEffect } from 'react'
import { Users, Trash2, ShieldCheck, ShieldAlert, X, RefreshCw, Copy } from 'lucide-react'
import { resolveAvatarUrl } from '../utils/avatar.js'

export default function AdminPanel({ token, onClose }) {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [stats, setStats] = useState(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')

  const fetchUsers = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/users', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store'
      })
      if (!res.ok) throw new Error('Ошибка доступа или сервера')
      const data = await res.json()
      setUsers(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const fetchStats = async () => {
    try {
      const res = await fetch('/api/admin/stats', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store'
      })
      if (res.ok) {
        const data = await res.json()
        setStats(data)
      }
    } catch {}
  }

  useEffect(() => {
    fetchUsers()
    fetchStats()
    const timer = setInterval(fetchUsers, 10000)
    return () => clearInterval(timer)
  }, [])

  const deleteUser = async (userId, username) => {
    if (!window.confirm(`Вы уверены, что хотите УДАЛИТЬ пользователя ${username}? Все его данные будут стерты.`)) return
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.ok) {
        await fetchUsers()
      } else {
        const text = await res.text().catch(() => '')
        let message = 'Ошибка удаления'
        try {
          const d = JSON.parse(text || '{}')
          message = d.error || message
        } catch {
          if (text) message = text
        }
        alert(message)
      }
    } catch (err) {
      alert('Ошибка сети')
    }
  }

  const promoteUser = async (userId) => {
    if (!window.confirm('Назначить этого пользователя администратором?')) return
    try {
      const res = await fetch(`/api/admin/users/${userId}/promote`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.ok) fetchUsers()
    } catch (err) {
       alert('Ошибка сети')
    }
  }

  const copyText = async (value) => {
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
    } catch {}
  }

  const filteredUsers = users.filter(u => {
    if (filter === 'online' && !u.online) return false
    if (filter === 'admin' && !u.is_admin) return false
    if (query) {
      const q = query.toLowerCase()
      const hay = `${u.username} ${u.display_name}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })

  return (
    <div className="admin-overlay" style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.8)', zIndex: 2000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: window.innerWidth < 640 ? '0' : '20px'
    }}>
      <div className="glass admin-modal" style={{
        width: '100%', maxWidth: '900px', height: window.innerWidth < 640 ? '100%' : '85vh',
        borderRadius: window.innerWidth < 640 ? '0' : '24px', display: 'flex', flexDirection: 'column',
        overflow: 'hidden', border: '1px solid var(--border)'
      }}>
        {/* Header */}
        <div style={{ padding: '20px 25px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'rgba(255,255,255,0.05)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
             <ShieldCheck size={28} color="var(--primary)" />
             <h2 style={{ margin: 0, fontSize: '1.4rem' }}>Пользователи</h2>
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
             <button onClick={() => { fetchUsers(); fetchStats() }} className="btn" style={{ padding: '8px', background: 'transparent' }} title="Обновить">
                <RefreshCw size={20} className={loading ? 'spin' : ''} />
             </button>
             <button onClick={onClose} className="btn" style={{ padding: '8px', background: 'transparent' }}>
                <X size={24} />
             </button>
          </div>
        </div>

        {/* Content */}
        <div className="admin-content" style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
          {error && <div style={{ color: '#f7768e', textAlign: 'center', marginBottom: '15px' }}>{error}</div>}

          <div className="glass" style={{ padding: '14px 16px', borderRadius: '16px', marginBottom: '16px', display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Users size={18} color="var(--primary)" />
              <div style={{ fontWeight: 700 }}>Всего: {stats?.users ?? users.length}</div>
            </div>
            <div style={{ color: 'var(--text-dim)' }}>Онлайн: {stats?.online ?? users.filter(u => u.online).length}</div>
            <div style={{ color: 'var(--text-dim)' }}>Админов: {stats?.admins ?? users.filter(u => u.is_admin).length}</div>
            <div style={{ color: 'var(--text-dim)' }}>Чатов: {stats?.chats ?? 0}</div>
            <div style={{ color: 'var(--text-dim)' }}>Сообщений: {stats?.messages ?? 0}</div>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
            <input
              className="input"
              placeholder="Поиск пользователя"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ flex: 1, minWidth: 220 }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              {['all', 'online', 'admin'].map(key => (
                <button
                  key={key}
                  onClick={() => setFilter(key)}
                  className="btn"
                  style={{
                    padding: '10px 14px',
                    background: filter === key ? 'rgba(79,124,255,0.18)' : 'rgba(255,255,255,0.06)',
                    color: filter === key ? 'var(--text)' : 'var(--text-dim)'
                  }}
                >
                  {key === 'all' ? 'Все' : key === 'online' ? 'Онлайн' : 'Админы'}
                </button>
              ))}
            </div>
          </div>
          
          {/* Desktop Table */}
          <div className="desktop-only">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '2px solid var(--border)', color: 'var(--text-dim)' }}>
                  <th style={{ padding: '12px' }}>Пользователь</th>
                  <th style={{ padding: '12px' }}>Логин</th>
                  <th style={{ padding: '12px' }}>Статус</th>
                  <th style={{ padding: '12px', textAlign: 'right' }}>Действия</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map(u => (
                  <tr key={u.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div style={{ width: '32px', height: '32px', borderRadius: '50%', backgroundColor: u.avatar_color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', overflow: 'hidden' }}>
                          {u.avatar_object_key ? <img src={resolveAvatarUrl(u.id, u.avatar_object_key)} alt={u.display_name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : u.display_name[0].toUpperCase()}
                        </div>
                        <div>
                          {u.display_name} {u.is_admin && <span style={{ color: 'var(--primary)', fontSize: '0.7rem' }}>[ADM]</span>}
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>{u.last_seen ? `Последний раз: ${new Date(u.last_seen).toLocaleString()}` : 'Нет данных'}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: '12px', color: 'var(--text-dim)' }}>@{u.username}</td>
                    <td style={{ padding: '12px' }}>{u.online ? <span style={{ color: '#9ece6a' }}>Онлайн</span> : 'Оффлайн'}</td>
                    <td style={{ padding: '12px', textAlign: 'right' }}>
                       <button onClick={() => copyText(u.id)} className="btn" style={{ padding: '6px', background: 'transparent', color: 'var(--text-dim)' }} title="Скопировать ID">
                         <Copy size={16} />
                       </button>
                       {!u.is_admin && <button onClick={() => promoteUser(u.id)} className="btn" style={{ padding: '6px', background: 'transparent', color: 'var(--primary)' }}><ShieldAlert size={16} /></button>}
                       <button onClick={() => deleteUser(u.id, u.username)} className="btn" style={{ padding: '6px', background: 'transparent', color: '#f7768e' }}><Trash2 size={16} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile Cards */}
          <div className="mobile-only">
             {filteredUsers.map(u => (
               <div key={u.id} className="glass" style={{ padding: '15px', borderRadius: '16px', marginBottom: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{ width: '44px', height: '44px', borderRadius: '50%', backgroundColor: u.avatar_color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem', fontWeight: 'bold', overflow: 'hidden' }}>
                      {u.avatar_object_key ? <img src={resolveAvatarUrl(u.id, u.avatar_object_key)} alt={u.display_name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : u.display_name[0].toUpperCase()}
                    </div>
                    <div>
                      <div style={{ fontWeight: 'bold' }}>{u.display_name} {u.is_admin && <span style={{ color: 'var(--primary)' }}>★</span>}</div>
                      <div style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>@{u.username} • {u.online ? 'Онлайн' : 'Оффлайн'}</div>
                      <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>{u.last_seen ? new Date(u.last_seen).toLocaleString() : 'Нет данных'}</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '5px' }}>
                     <button onClick={() => copyText(u.id)} className="btn" style={{ padding: '10px', background: 'rgba(255,255,255,0.08)', color: 'var(--text-dim)' }}><Copy size={18} /></button>
                     {!u.is_admin && <button onClick={() => promoteUser(u.id)} className="btn" style={{ padding: '10px', background: 'rgba(56,189,248,0.1)', color: 'var(--primary)' }}><ShieldAlert size={20} /></button>}
                     <button onClick={() => deleteUser(u.id, u.username)} className="btn" style={{ padding: '10px', background: 'rgba(247,118,142,0.1)', color: '#f7768e' }}><Trash2 size={20} /></button>
                  </div>
               </div>
             ))}
          </div>

          {filteredUsers.length === 0 && !loading && (
             <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-dim)' }}>Пользователи не найдены</div>
          )}
        </div>
      </div>
    </div>
  )
}
