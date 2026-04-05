import React, { useMemo, useRef, useState } from 'react'
import { X, Sparkles, ImagePlus, User, Check, Bell } from 'lucide-react'
import { resizeImageFile } from '../utils/image.js'
import { resolveAvatarUrl } from '../utils/avatar.js'

const presetList = [
  {
    id: 'pulse',
    name: 'Pulse',
    description: 'Мягкий неон',
    settings: {
      presetId: 'pulse',
      accentTheme: 'mint',
      compactMode: false,
      bubbleStyle: 'rounded',
      animations: true,
      animatedBackdrop: true,
      richNotifications: true,
      wallpaperIntensity: 72,
      wallpaperImage: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="1400"><rect width="100%" height="100%" fill="%230f1324"/><radialGradient id="g1" cx="20%" cy="15%"><stop offset="0%" stop-color="%234fd1c5" stop-opacity="0.25"/><stop offset="70%" stop-color="%230f1324" stop-opacity="0"/></radialGradient><radialGradient id="g2" cx="85%" cy="70%"><stop offset="0%" stop-color="%237aa2ff" stop-opacity="0.2"/><stop offset="70%" stop-color="%230f1324" stop-opacity="0"/></radialGradient><rect width="100%" height="100%" fill="url(%23g1)"/><rect width="100%" height="100%" fill="url(%23g2)"/></svg>',
      fontScale: 1.02,
      glassBlur: 20,
      messageGap: 10,
      bubbleOpacity: 0.92,
      panelRadius: 26,
      listStyle: 'cards',
      sidebarStyle: 'glass',
      avatarShape: 'circle',
      accentGlow: true,
    },
  },
  {
    id: 'glass_ion',
    name: 'Glass Ion',
    description: 'Премиум стекло',
    settings: {
      presetId: 'glass_ion',
      accentTheme: 'ocean',
      compactMode: false,
      bubbleStyle: 'rounded',
      animations: true,
      animatedBackdrop: true,
      richNotifications: true,
      wallpaperIntensity: 90,
      wallpaperImage: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200"><defs><radialGradient id="g" cx="18%" cy="12%"><stop offset="0%" stop-color="%2359a7ff" stop-opacity="0.75"/><stop offset="70%" stop-color="%230b0f1a" stop-opacity="0"/></radialGradient></defs><rect width="100%" height="100%" fill="%230b0f1a"/><rect width="100%" height="100%" fill="url(%23g)"/><circle cx="980" cy="980" r="420" fill="%23a78bfa" fill-opacity="0.08"/><path d="M0 860 C240 760 420 920 640 860 C860 800 980 760 1200 820" stroke="%237aa2ff" stroke-width="140" stroke-opacity="0.08" fill="none"/></svg>',
      fontScale: 1.02,
      glassBlur: 34,
      messageGap: 12,
      bubbleOpacity: 0.98,
      panelRadius: 30,
      listStyle: 'cards',
      sidebarStyle: 'glass',
      avatarShape: 'squircle',
      accentGlow: true,
    },
  },
  {
    id: 'neon_rush',
    name: 'Neon Circuit',
    description: 'Неон + контуры',
    settings: {
      presetId: 'neon_rush',
      accentTheme: 'aurora',
      compactMode: false,
      bubbleStyle: 'sharp',
      animations: true,
      animatedBackdrop: true,
      richNotifications: true,
      wallpaperIntensity: 100,
      wallpaperImage: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200"><rect width="100%" height="100%" fill="%23060a12"/><path d="M-40 220 Q300 80 680 210 T1320 220" stroke="%238b7cff" stroke-width="160" stroke-opacity="0.25" fill="none"/><path d="M-40 520 Q340 380 700 520 T1320 520" stroke="%23ff8f63" stroke-width="130" stroke-opacity="0.2" fill="none"/><circle cx="200" cy="980" r="300" fill="%23ff8f63" fill-opacity="0.12"/><circle cx="980" cy="180" r="220" fill="%238b7cff" fill-opacity="0.08"/></svg>',
      fontScale: 1.04,
      glassBlur: 10,
      messageGap: 8,
      bubbleOpacity: 0.86,
      panelRadius: 12,
      listStyle: 'cards',
      sidebarStyle: 'glass',
      avatarShape: 'circle',
      accentGlow: true,
    },
  },
  {
    id: 'paper_minimal',
    name: 'Studio Mono',
    description: 'Минимал, плоско',
    settings: {
      presetId: 'paper_minimal',
      accentTheme: 'sunset',
      compactMode: true,
      bubbleStyle: 'rounded',
      animations: false,
      animatedBackdrop: false,
      richNotifications: true,
      wallpaperIntensity: 14,
      wallpaperImage: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200"><rect width="100%" height="100%" fill="%230f121a"/><rect x="0" y="0" width="1200" height="1200" fill="%23ffffff" fill-opacity="0.02"/><path d="M0 0 L1200 0 L1200 1200 L0 1200 Z" fill="none" stroke="%23ffffff" stroke-opacity="0.04" stroke-width="2"/></svg>',
      fontScale: 0.96,
      glassBlur: 4,
      messageGap: 6,
      bubbleOpacity: 0.8,
      panelRadius: 10,
      listStyle: 'flat',
      sidebarStyle: 'solid',
      avatarShape: 'circle',
      accentGlow: false,
    },
  },
  {
    id: 'noir_dense',
    name: 'Noir Pulse',
    description: 'Тёмный, плотный',
    settings: {
      presetId: 'noir_dense',
      accentTheme: 'ocean',
      compactMode: true,
      bubbleStyle: 'sharp',
      animations: false,
      animatedBackdrop: false,
      richNotifications: true,
      wallpaperIntensity: 18,
      wallpaperImage: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200"><rect width="100%" height="100%" fill="%23070812"/><path d="M-40 920 L1240 620" stroke="%232c5bff" stroke-width="140" stroke-opacity="0.1"/><circle cx="1040" cy="180" r="200" fill="%2359a7ff" fill-opacity="0.06"/></svg>',
      fontScale: 0.94,
      glassBlur: 8,
      messageGap: 4,
      bubbleOpacity: 0.9,
      panelRadius: 8,
      listStyle: 'flat',
      sidebarStyle: 'solid',
      avatarShape: 'circle',
      accentGlow: false,
    },
  },
]

export default function SettingsPanel({ token, user, settings, onChange, onClose, onAvatarUpdated }) {
  const [uploading, setUploading] = useState(false)
  const avatarInputRef = useRef(null)

  const avatarUrl = useMemo(() => {
    if (!user) return null
    return user.avatar_url || resolveAvatarUrl(user.id, user.avatar_object_key)
  }, [user])

  const applyPreset = (preset) => {
    if (!preset?.settings) return
    onChange({
      ...settings,
      ...preset.settings,
      notifyMessages: settings.notifyMessages,
      notifyCalls: settings.notifyCalls,
      pushTone: settings.pushTone,
      messageIncomingTone: settings.messageIncomingTone,
      messageOutgoingTone: settings.messageOutgoingTone,
      callRingtone: settings.callRingtone,
      richNotifications: settings.richNotifications,
    })
  }

  const handleAvatarPick = async (event) => {
    const file = event.target.files?.[0]
    if (!file || !token) return
    setUploading(true)
    try {
      const resizedBlob = await resizeImageFile(file, { maxSize: 320, type: 'image/webp', quality: 0.86, square: true, output: 'blob' })
      const blob = resizedBlob || file
      const form = new FormData()
      const uploadFile = blob instanceof Blob ? new File([blob], 'avatar.webp', { type: blob.type || 'image/webp' }) : file
      form.append('file', uploadFile)
      const res = await fetch('/api/users/me/avatar', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      })
      if (res.ok) {
        const payload = await res.json()
        const fresh = await fetch('/api/users/me', { headers: { Authorization: `Bearer ${token}` } })
        if (fresh.ok) {
          const me = await fresh.json()
          onAvatarUpdated?.(me)
        } else {
          onAvatarUpdated?.(payload)
        }
      }
    } finally {
      setUploading(false)
      event.target.value = ''
    }
  }

  const handleAvatarRemove = async () => {
    if (!token) return
    setUploading(true)
    try {
      const res = await fetch('/api/users/me/avatar', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const fresh = await fetch('/api/users/me', { headers: { Authorization: `Bearer ${token}` } })
        if (fresh.ok) {
          const me = await fresh.json()
          onAvatarUpdated?.(me)
        } else {
          onAvatarUpdated?.({ avatar_object_key: null, avatar_url: null })
        }
      }
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="glass settings-panel" onClick={(e) => e.stopPropagation()}>
        <button className="qr-close-btn" onClick={onClose}><X size={18} /></button>
        <div className="settings-header">
          <div className="settings-kicker"><Sparkles size={16} /> Быстрые пресеты</div>
          <h2>Внешний вид</h2>
          <p>Выберите готовый стиль одним нажатием. Настроек больше нет — только пресеты.</p>
        </div>

        <section className="settings-card profile-card">
          <div className="settings-card-title"><User size={16} /> Мой профиль</div>
          <div className="profile-row">
            <div className={`profile-avatar ${avatarUrl ? 'has-photo' : ''}`}>
              {avatarUrl ? <img src={avatarUrl} alt={user?.display_name || 'avatar'} /> : (user?.display_name || '?').charAt(0).toUpperCase()}
            </div>
            <div className="profile-meta">
              <div className="profile-name">{user?.display_name || 'Пользователь'}</div>
              <div className="profile-sub">@{user?.username || 'username'}</div>
            </div>
            <div className="profile-actions">
              <input ref={avatarInputRef} type="file" accept="image/*" onChange={handleAvatarPick} style={{ display: 'none' }} />
              <button type="button" className="btn subtle-cta" onClick={() => avatarInputRef.current?.click()} disabled={uploading}>
                <ImagePlus size={16} /> {uploading ? 'Загрузка...' : 'Загрузить'}
              </button>
              {avatarUrl && (
                <button type="button" className="btn ghost-cta" onClick={handleAvatarRemove} disabled={uploading}>
                  Удалить
                </button>
              )}
            </div>
          </div>
        </section>

        <section className="settings-card notifications-card">
          <div className="settings-card-title"><Bell size={16} /> Уведомления</div>
          <label className="toggle-row">
            <span>Сообщения</span>
            <input type="checkbox" checked={settings.notifyMessages} onChange={(e) => onChange({ ...settings, notifyMessages: e.target.checked })} />
          </label>
          <label className="toggle-row">
            <span>Звонки</span>
            <input type="checkbox" checked={settings.notifyCalls} onChange={(e) => onChange({ ...settings, notifyCalls: e.target.checked })} />
          </label>
          <label className="toggle-row">
            <span>Показывать текст</span>
            <input type="checkbox" checked={settings.richNotifications} onChange={(e) => onChange({ ...settings, richNotifications: e.target.checked })} />
          </label>
          <div className="segmented-control tone-picker">
            <button type="button" className={settings.pushTone === 'soft' ? 'active' : ''} onClick={() => onChange({ ...settings, pushTone: 'soft' })}>Soft</button>
            <button type="button" className={settings.pushTone === 'bright' ? 'active' : ''} onClick={() => onChange({ ...settings, pushTone: 'bright' })}>Bright</button>
            <button type="button" className={settings.pushTone === 'deep' ? 'active' : ''} onClick={() => onChange({ ...settings, pushTone: 'deep' })}>Deep</button>
            <button type="button" className={settings.pushTone === 'silent' ? 'active' : ''} onClick={() => onChange({ ...settings, pushTone: 'silent' })}>Silent</button>
          </div>
          <div className="settings-subtitle">Звук входящего сообщения</div>
          <div className="segmented-control tone-picker">
            <button type="button" className={settings.messageIncomingTone === 'soft' ? 'active' : ''} onClick={() => onChange({ ...settings, messageIncomingTone: 'soft' })}>Soft</button>
            <button type="button" className={settings.messageIncomingTone === 'bright' ? 'active' : ''} onClick={() => onChange({ ...settings, messageIncomingTone: 'bright' })}>Bright</button>
            <button type="button" className={settings.messageIncomingTone === 'deep' ? 'active' : ''} onClick={() => onChange({ ...settings, messageIncomingTone: 'deep' })}>Deep</button>
            <button type="button" className={settings.messageIncomingTone === 'silent' ? 'active' : ''} onClick={() => onChange({ ...settings, messageIncomingTone: 'silent' })}>Silent</button>
          </div>
          <div className="settings-subtitle">Звук исходящего сообщения</div>
          <div className="segmented-control tone-picker">
            <button type="button" className={settings.messageOutgoingTone === 'soft' ? 'active' : ''} onClick={() => onChange({ ...settings, messageOutgoingTone: 'soft' })}>Soft</button>
            <button type="button" className={settings.messageOutgoingTone === 'bright' ? 'active' : ''} onClick={() => onChange({ ...settings, messageOutgoingTone: 'bright' })}>Bright</button>
            <button type="button" className={settings.messageOutgoingTone === 'deep' ? 'active' : ''} onClick={() => onChange({ ...settings, messageOutgoingTone: 'deep' })}>Deep</button>
            <button type="button" className={settings.messageOutgoingTone === 'silent' ? 'active' : ''} onClick={() => onChange({ ...settings, messageOutgoingTone: 'silent' })}>Silent</button>
          </div>
          <div className="settings-subtitle">Рингтон звонка</div>
          <div className="segmented-control tone-picker">
            <button type="button" className={settings.callRingtone === 'classic' ? 'active' : ''} onClick={() => onChange({ ...settings, callRingtone: 'classic' })}>Classic</button>
            <button type="button" className={settings.callRingtone === 'digital' ? 'active' : ''} onClick={() => onChange({ ...settings, callRingtone: 'digital' })}>Digital</button>
            <button type="button" className={settings.callRingtone === 'retro' ? 'active' : ''} onClick={() => onChange({ ...settings, callRingtone: 'retro' })}>Retro</button>
          </div>
        </section>

        <div className="preset-grid">
          {presetList.map(preset => (
            <button
              key={preset.id}
              type="button"
              data-preset={preset.id}
              className={`preset-card ${settings.presetId === preset.id ? 'active' : ''}`}
              onClick={() => applyPreset(preset)}
            >
              <div className="preset-top">
                <div>
                  <div className="preset-title">{preset.name}</div>
                  <div className="preset-desc">{preset.description}</div>
                </div>
                {settings.presetId === preset.id && (
                  <span className="preset-check"><Check size={16} /></span>
                )}
              </div>
              <div className="preset-preview" data-theme={preset.settings.accentTheme}>
                <div className="preset-chip" />
                <div className="preset-lines">
                  <span />
                  <span />
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
