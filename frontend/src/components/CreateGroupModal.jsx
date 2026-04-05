import React, { useState, useEffect } from 'react'
import { X, Users, Check, Search } from 'lucide-react'

// Modal for creating a new group chat
export default function CreateGroupModal({ token, user, onClose, onCreate }) {
  const [name, setName] = useState('')
  const [friends, setFriends] = useState([])
  const [selected, setSelected] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    fetch('/api/users/search', { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.json())
      .then(data => {
        setFriends(data.filter(u => u.id !== user.id))
        setLoading(false)
      })
  }, [token, user.id])

  const toggleSelect = (id) => {
    setSelected(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id])
  }

  const handleSubmit = async () => {
    if (!name.trim() || selected.length === 0) return
    const res = await fetch('/api/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        is_group: true,
        name: name.trim(),
        member_ids: selected
      })
    })
    if (res.ok) {
      const data = await res.json()
      onCreate?.(data.chat || null)
      onClose()
    } else {
      alert('Ошибка при создании группы')
    }
  }

  const filteredFriends = friends.filter(f => 
    f.display_name.toLowerCase().includes(search.toLowerCase()) || 
    f.username.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="admin-overlay" style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.8)', zIndex: 2000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '20px'
    }}>
      <div className="glass" style={{
        width: '100%', maxWidth: '450px', borderRadius: '24px',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        border: '1px solid var(--border)'
      }}>
        <div style={{ padding: '20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Users size={20} color="var(--primary)" /> Новая группа
          </h2>
          <button onClick={onClose} className="btn" style={{ background: 'transparent', padding: '5px' }}><X size={24} /></button>
        </div>

        <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
          <input 
            type="text" className="input" placeholder="Название группы" 
            value={name} onChange={e => setName(e.target.value)} 
          />
          
          <div style={{ position: 'relative' }}>
             <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dim)' }} />
             <input 
                type="text" className="input" placeholder="Поиск участников..." 
                style={{ paddingLeft: '35px', fontSize: '0.9rem' }}
                value={search} onChange={e => setSearch(e.target.value)}
             />
          </div>

          <div style={{ maxHeight: '250px', overflowY: 'auto' }}>
            {filteredFriends.map(f => (
              <div 
                key={f.id} 
                onClick={() => toggleSelect(f.id)}
                style={{ 
                  display: 'flex', alignItems: 'center', gap: '12px', padding: '10px', 
                  cursor: 'pointer', borderRadius: '12px', marginBottom: '4px',
                  backgroundColor: selected.includes(f.id) ? 'rgba(56,189,248,0.1)' : 'transparent'
                }}
              >
                <div style={{ width: 36, height: 36, borderRadius: '12px', backgroundColor: f.avatar_color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold' }}>
                  {f.display_name[0].toUpperCase()}
                </div>
                <div style={{ flex: 1 }}>{f.display_name}</div>
                {selected.includes(f.id) && <Check size={18} color="var(--primary)" />}
              </div>
            ))}
            {loading && <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-dim)' }}>Загрузка...</div>}
          </div>

          <button 
            className="btn" 
            onClick={handleSubmit} 
            disabled={!name.trim() || selected.length === 0}
            style={{ width: '100%', marginTop: '10px' }}
          >
            Создать группу ({selected.length})
          </button>
        </div>
      </div>
    </div>
  )
}
