import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { Users, MessageSquare, Plus, RefreshCw, Search, Star, UserPlus, QrCode, Trash2, X } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { resolveAvatarUrl } from '../utils/avatar.js'
import QRScanner from './QRScanner'

function normalizeChat(raw) {
  if (!raw) return null
  return {
    ...raw,
    group_name: raw.group_name || raw.name,
    partner: raw.is_group ? null : {
      id: raw.partner_id,
      username: raw.partner_username,
      display_name: raw.partner_name,
      avatar_color: raw.partner_color,
      avatar_object_key: raw.partner_avatar_key,
      public_key: raw.partner_public_key,
      online: raw.partner_online,
      last_seen: raw.partner_last_seen,
    },
  }
}

function applyPresenceToChat(chat, presenceMap) {
  if (!chat || chat.is_group) return chat
  const partnerId = chat.partner?.id || chat.partner_id
  if (!partnerId || typeof presenceMap[partnerId] === 'undefined') return chat
  return {
    ...chat,
    partner_online: presenceMap[partnerId],
    partner: chat.partner ? { ...chat.partner, online: presenceMap[partnerId] } : chat.partner,
  }
}

export default function ChatList({ token, user, refreshNonce = 0, presenceMap = {}, onSelectChat, selectedChatId, onCreateGroup, compactMode = false }) {
  const [chats, setChats] = useState([])
  const [contacts, setContacts] = useState([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false)
  const [showAddContact, setShowAddContact] = useState(false)
  const [showContactScanner, setShowContactScanner] = useState(false)
  const [contactIdentifier, setContactIdentifier] = useState('')
  const [addContactError, setAddContactError] = useState('')
  const [pinnedChats, setPinnedChats] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('chatik_pinned_chats') || '[]')
    } catch {
      return []
    }
  })

  const fetchChats = useCallback(async () => {
    const res = await fetch('/api/chats', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
    if (!res.ok) throw new Error('Не удалось загрузить чаты')
    const data = await res.json()
    setChats(data.map(normalizeChat))
  }, [token])

  const fetchContacts = useCallback(async () => {
    const res = await fetch('/api/users/contacts', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
    if (!res.ok) throw new Error('Не удалось загрузить контакты')
    const data = await res.json()
    setContacts(Array.isArray(data) ? data : [])
  }, [token])

  const refreshAll = useCallback(async () => {
    setLoading(true)
    try {
      await Promise.all([fetchChats(), fetchContacts()])
    } finally {
      setLoading(false)
    }
  }, [fetchChats, fetchContacts])

  useEffect(() => {
    refreshAll()
  }, [refreshAll, refreshNonce])

  useEffect(() => {
    localStorage.setItem('chatik_pinned_chats', JSON.stringify(pinnedChats))
  }, [pinnedChats])

  useEffect(() => {
    if (!token) return undefined
    const chatsTimer = setInterval(() => {
      fetchChats().catch(() => {})
    }, 3000)
    const usersTimer = setInterval(() => {
      fetchContacts().catch(() => {})
    }, 6000)
    return () => {
      clearInterval(chatsTimer)
      clearInterval(usersTimer)
    }
  }, [fetchChats, fetchContacts, token])

  const addContact = useCallback(async (identifierRaw) => {
    const identifier = (identifierRaw || '').trim()
    if (!identifier) return
    setAddContactError('')
    const res = await fetch('/api/users/contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ identifier }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setAddContactError(data.error || 'Не удалось добавить контакт')
      return
    }
    const contact = data.contact
    if (contact) {
      setContacts(prev => {
        if (prev.some(item => item.id === contact.id)) return prev
        return [...prev, contact]
      })
    }
    setContactIdentifier('')
    setShowAddContact(false)
    setShowContactScanner(false)
  }, [token])

  const removeContact = useCallback(async (contactId) => {
    await fetch(`/api/users/contacts/${contactId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    setContacts(prev => prev.filter(item => item.id !== contactId))
  }, [token])

  const handleContactQrScan = useCallback(async (payload) => {
    if (!payload) return
    let identifier = String(payload).trim()
    if (!identifier) return
    if (identifier.startsWith('chatik-contact:')) {
      identifier = identifier.replace('chatik-contact:', '').trim()
    } else {
      try {
        const parsed = JSON.parse(identifier)
        if (parsed?.u?.id) identifier = parsed.u.id
      } catch {}
    }
    await addContact(identifier)
  }, [addContact])

  const startChat = async (partner) => {
    const existing = chats.find(c => !c.is_group && (c.partner?.id || c.partner_id) === partner.id)
    if (existing) {
      onSelectChat(applyPresenceToChat(existing, presenceMap))
      return
    }

    const res = await fetch('/api/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ partner_id: partner.id })
    })
    if (!res.ok) {
      const errorText = await res.text().catch(() => '')
      console.error('Не удалось открыть чат', errorText)
      return
    }

    const payload = await res.json()
    const chat = payload.chat ? normalizeChat(payload.chat) : normalizeChat({
      id: payload.chat_id,
      is_group: false,
      partner_id: partner.id,
      partner_name: partner.display_name,
      partner_username: partner.username,
      partner_color: partner.avatar_color,
      partner_avatar_key: partner.avatar_object_key,
      partner_public_key: partner.public_key,
      partner_online: typeof presenceMap[partner.id] === 'boolean' ? presenceMap[partner.id] : partner.online,
      partner_last_seen: partner.last_seen,
      last_message: null,
      last_message_at: null,
    })

    const nextChatId = payload.chat_id || chat.id
    setChats(prev => [chat, ...prev.filter(item => item.id !== nextChatId)])
    onSelectChat(chat)
  }

  const renderAvatar = (name, bg, online = false, photo = null) => (
    <div
      className={`chat-avatar ${photo ? 'has-photo' : ''} ${online ? 'is-online' : ''}`}
      style={{ backgroundColor: photo ? 'transparent' : (bg || '#334155') }}
    >
      {photo ? <img src={photo} alt={name || 'avatar'} /> : (name || '?').charAt(0).toUpperCase()}
    </div>
  )

  const unifiedList = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const chatItems = chats.map(chat => applyPresenceToChat(chat, presenceMap))
    const existingPartnerIds = new Set(
      chatItems.filter(c => !c.is_group).map(c => c.partner?.id || c.partner_id)
    )
    const userItems = contacts
      .map(u => ({ ...u, online: typeof presenceMap[u.id] === 'boolean' ? presenceMap[u.id] : u.online }))
      .filter(u => !existingPartnerIds.has(u.id))

    const items = [
      ...chatItems.map(chat => ({ type: 'chat', chat, pinned: pinnedChats.includes(chat.id) })),
      ...userItems.map(userItem => ({ type: 'user', user: userItem })),
    ]

    const filtered = items.filter(item => {
      const title = item.type === 'chat'
        ? (item.chat.is_group ? item.chat.group_name : item.chat.partner?.display_name || item.chat.partner_name || '')
        : (item.user.display_name || '')
      const username = item.type === 'chat'
        ? (item.chat.partner?.username || item.chat.partner_username || '')
        : (item.user.username || '')
      if (!needle) return true
      return title.toLowerCase().includes(needle) || username.toLowerCase().includes(needle)
    })

    const ordered = filtered.sort((a, b) => {
      if (a.type === 'chat' && b.type === 'chat') {
        if (a.pinned && !b.pinned) return -1
        if (!a.pinned && b.pinned) return 1
      }
      if (a.type === 'chat' && b.type === 'user') return -1
      if (a.type === 'user' && b.type === 'chat') return 1
      return 0
    })

    return showFavoritesOnly
      ? ordered.filter(item => item.type === 'chat' && item.pinned)
      : ordered
  }, [chats, contacts, pinnedChats, presenceMap, query, showFavoritesOnly])

  const addContactModal = showAddContact ? (
        <div className="contact-modal-overlay" onClick={() => { setShowAddContact(false); setShowContactScanner(false) }}>
          <div className="contact-modal" onClick={(e) => e.stopPropagation()}>
        <div className="contact-modal-title-row">
          <span>Добавить контакт</span>
          <button
            type="button"
            className="icon-btn subtle-btn contact-modal-close"
            onClick={() => {
              setShowAddContact(false)
              setShowContactScanner(false)
            }}
          >
            <X size={14} />
          </button>
        </div>
        <div className="contact-add-row">
          <input
            className="input"
            placeholder="ID или @username"
            value={contactIdentifier}
            onChange={(e) => setContactIdentifier(e.target.value)}
          />
          <button type="button" className="btn contact-add-btn" onClick={() => addContact(contactIdentifier)}>Добавить</button>
        </div>
        {!!addContactError && <div className="contact-add-error">{addContactError}</div>}
        <div className="contact-modal-actions">
          <button
            type="button"
            className="btn subtle-cta"
            onClick={() => {
              setShowAddContact(false)
              setShowContactScanner(true)
            }}
          >
            <QrCode size={16} /> Сканировать QR
          </button>
        </div>
        <div className="contact-modal-caption">Ваш QR для добавления:</div>
        <div className="contact-modal-qr-wrap">
          <QRCodeSVG value={`chatik-contact:${user?.id || ''}`} size={160} includeMargin />
        </div>
      </div>
    </div>
  ) : null

  return (
    <div className={`chat-list-shell ${compactMode ? 'compact-mode' : ''}`}>
      <div className="chat-list-topbar" style={{ justifyContent: 'space-between' }}>
        <div className="section-title" style={{ margin: 0 }}>Контакты и чаты</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => { setAddContactError(''); setShowAddContact(true) }} className="icon-btn subtle-btn" title="Добавить контакт">
            <UserPlus size={18} />
          </button>
          <button onClick={refreshAll} className="icon-btn subtle-btn" title="Обновить">
            <RefreshCw size={18} />
          </button>
          <button onClick={onCreateGroup} className="icon-btn accent-soft" title="Создать группу">
            <Plus size={20} />
          </button>
        </div>
      </div>

      <div className="chat-filters">
        <button type="button" className={showFavoritesOnly ? '' : 'active'} onClick={() => setShowFavoritesOnly(false)}>Все</button>
        <button type="button" className={showFavoritesOnly ? 'active' : ''} onClick={() => setShowFavoritesOnly(true)}>Избранные</button>
      </div>

      <div className="chat-search-shell">
        <div className="search-wrap">
          <Search size={16} className="search-icon" />
          <input
            className="input search-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск"
          />
        </div>
      </div>

      <div className="chat-list-scroll">
        <div>
          <div className="section-title">Контакты</div>
          {unifiedList.map((item) => {
            if (item.type === 'chat') {
              const c = item.chat
              const isSelected = c.id === selectedChatId
              const title = c.is_group ? c.group_name : c.partner?.display_name || c.partner_name || 'Чат'
              const subtitle = c.unread_count > 0
                ? 'Есть сообщения'
                : (c.is_group ? 'Групповой чат' : `@${c.partner?.username || c.partner_username || ''}`)
              const partnerId = c.partner?.id || c.partner_id
              const avatarUrl = !c.is_group
                ? (c.partner?.avatar_url || resolveAvatarUrl(partnerId, c.partner?.avatar_object_key || c.partner_avatar_key))
                : null
              const isPinned = pinnedChats.includes(c.id)
              return (
                <div
                  key={`chat_${c.id}`}
                  onClick={() => onSelectChat(c)}
                  className={`chat-list-item ${isSelected ? 'selected' : ''}`}
                >
                  {c.is_group ? (
                    <div className="chat-avatar group-avatar">
                      <Users size={22} />
                    </div>
                  ) : renderAvatar(title, c.partner?.avatar_color || c.partner_color, c.partner?.online || c.partner_online, avatarUrl)}
                  <div className="chat-list-main">
                    <div className="chat-row-top">
                      <div className="chat-name">{title}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <button
                          type="button"
                          className={`pin-btn ${isPinned ? 'active' : ''}`}
                          title={isPinned ? 'Убрать из избранного' : 'В избранное'}
                          onClick={(e) => {
                            e.stopPropagation()
                            setPinnedChats(prev => (
                              prev.includes(c.id) ? prev.filter(id => id !== c.id) : [c.id, ...prev]
                            ))
                          }}
                        >
                          <Star size={14} />
                        </button>
                        {c.unread_count > 0 && (
                          <div className="unread-badge">
                            {c.unread_count > 99 ? '99+' : c.unread_count}
                          </div>
                        )}
                        {c.last_message_at && <div className="chat-time">{new Date(c.last_message_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>}
                      </div>
                    </div>
                    <div className="chat-row-bottom">{subtitle}</div>
                  </div>
                </div>
              )
            }

            const u = item.user
            if (u.id === user?.id) return null
            return (
              <div
                key={`user_${u.id}`}
                onClick={() => startChat(u)}
                className="chat-list-item"
              >
                {renderAvatar(u.display_name, u.avatar_color, u.online, u.avatar_url || resolveAvatarUrl(u.id, u.avatar_object_key))}
                <div className="chat-list-main">
                  <div className="chat-row-top">
                    <div className="chat-name">{u.display_name}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div className="chat-time">{u.online ? 'онлайн' : ''}</div>
                      <button
                        type="button"
                        className="pin-btn"
                        title="Удалить из контактов"
                        onClick={(e) => {
                          e.stopPropagation()
                          removeContact(u.id).catch(() => {})
                        }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                  <div className="chat-row-bottom">Контакт · @{u.username}</div>
                </div>
              </div>
            )
          })}
          {!loading && unifiedList.length === 0 && (
            <div className="empty-state" style={{ paddingBottom: 8 }}>
              <MessageSquare size={40} style={{ marginBottom: '10px', opacity: 0.2 }} />
              <p>Контактов пока нет.</p>
            </div>
          )}
        </div>
      </div>

      {showAddContact && typeof document !== 'undefined' && createPortal(addContactModal, document.body)}

      {showContactScanner && typeof document !== 'undefined' && createPortal(
        <QRScanner
          onScan={(payload) => {
            handleContactQrScan(payload).catch(() => {})
          }}
          onClose={() => setShowContactScanner(false)}
        />,
        document.body
      )}
    </div>
  )
}
