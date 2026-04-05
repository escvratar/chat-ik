import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { encryptMessage, decryptMessage, decryptFile, encryptFile, decryptKeyWithPassword, generateKeyPair, encryptKeyWithPassword } from '../crypto/e2e.js'
import EmojiPicker from 'emoji-picker-react'
import { Smile, Paperclip, Trash2, Send, Phone, Video, ArrowLeft, Check, CheckCheck, Users, Mic, Square, Play, Pause, Search, X, Copy, Reply, Forward, Edit3, ThumbsUp, Heart, Laugh, AlertCircle, KeyRound, ShieldCheck, XCircle } from 'lucide-react'
import { resolveAvatarUrl } from '../utils/avatar.js'

export default function ChatWindow({
  token,
  user,
  chat,
  globalWsRef,
  wsConnected = false,
  liveIncomingMessages,
  onInitiateCall,
  onBack,
  onChatDeleted,
  compactMode = false,
  bubbleStyle = 'rounded',
  animations = true,
  onOutgoingMessageTone,
  onIncomingMessageTone,
}) {
  const [messages, setMessages] = useState([])
  const [inputText, setInputText] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [showSearch, setShowSearch] = useState(false)
  const [showEmoji, setShowEmoji] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadStatus, setUploadStatus] = useState(null)
  const [members, setMembers] = useState([])
  const [isRecording, setIsRecording] = useState(false)
  const [typingInfo, setTypingInfo] = useState(null)
  const [activeMessage, setActiveMessage] = useState(null)
  const [showActionSheet, setShowActionSheet] = useState(false)
  const [editingMessage, setEditingMessage] = useState(null)
  const [replyTo, setReplyTo] = useState(null)
  const [forwardModal, setForwardModal] = useState(false)
  const [forwardTargets, setForwardTargets] = useState({ chats: [], users: [] })
  const [keyStatus, setKeyStatus] = useState('checking')
  const [keyBanner, setKeyBanner] = useState(null)
  const [keyInfoOpen, setKeyInfoOpen] = useState(false)
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false)

  const messagesEndRef = useRef(null)
  const messageListRef = useRef(null)
  const mobileActionsRef = useRef(null)
  const inputRef = useRef(null)
  const fileInputRef = useRef(null)
  const mediaRecorderRef = useRef(null)
  const recordingChunksRef = useRef([])
  const pollingRef = useRef(null)
  const historyLoadingRef = useRef(false)
  const typingTimeoutRef = useRef(null)
  const typingLastSentRef = useRef(null)
  const holdTimerRef = useRef(null)
  const lastTapRef = useRef({ id: null, ts: 0 })
  const shouldAutoScrollRef = useRef(true)
  const lastMessageIdRef = useRef(null)
  const lastIncomingToneIdRef = useRef(null)
  const lastServerMessageAtRef = useRef(null)
  const partnerKeyRef = useRef(chat.partner?.public_key || chat.partner_public_key || null)
  const mySecretKey = user ? localStorage.getItem(`chatik_sk_${user.id}`) : null

  const partnerId = chat.partner?.id || chat.partner_id
  const partnerName = chat.partner?.display_name || chat.partner_name || 'Чат'
  const partnerOnline = chat.partner?.online || chat.partner_online
  const partnerAvatar = chat.partner?.avatar_color || chat.partner_color || 'var(--primary)'
  const partnerAvatarUrl = !chat.is_group
    ? resolveAvatarUrl(partnerId, chat.partner?.avatar_object_key || chat.partner_avatar_key)
    : null
  const lastSeenAt = chat.partner_last_seen || chat.partner?.last_seen || chat.partner?.last_seen_at || chat.partner_last_seen_at || null
  const formatLastSeen = (value) => {
    if (!value) return null
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return null
    return date.toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).replace(',', '')
  }
  const lastSeenFormatted = formatLastSeen(lastSeenAt)
  const lastSeenLabel = !partnerOnline && lastSeenFormatted ? `Был в сети ${lastSeenFormatted}` : null
  const callPartner = chat.partner || (partnerId ? {
    id: partnerId,
    display_name: partnerName,
    username: chat.partner_username,
    avatar_color: partnerAvatar,
    online: partnerOnline,
  } : null)

  const cacheMessageText = useCallback((id, text, clientId = null) => {
    if (!text) return
    try {
      const key = `chatik_msg_cache_${user.id}_${chat.id}`
      const current = JSON.parse(localStorage.getItem(key) || '{}')
      if (id) current[id] = text
      if (clientId) current[clientId] = text
      localStorage.setItem(key, JSON.stringify(current))
    } catch {}
  }, [chat.id, user.id])

  const getCachedMessageText = useCallback((id, clientId = null) => {
    try {
      const key = `chatik_msg_cache_${user.id}_${chat.id}`
      const current = JSON.parse(localStorage.getItem(key) || '{}')
      return (id && current[id]) || (clientId && current[clientId]) || null
    } catch {
      return null
    }
  }, [chat.id, user.id])

  const draftKey = useMemo(() => `chatik_draft_${user?.id || 'anon'}_${chat.id}`, [chat.id, user?.id])

  useEffect(() => {
    try {
      const draft = localStorage.getItem(draftKey)
      if (draft) setInputText(draft)
    } catch {}
  }, [draftKey])

  useEffect(() => {
    try {
      if (inputText) localStorage.setItem(draftKey, inputText)
      else localStorage.removeItem(draftKey)
    } catch {}
  }, [draftKey, inputText])

  useEffect(() => {
    if (chat.is_group) {
      fetch(`/api/chats/${chat.id}/members`, { headers: { Authorization: `Bearer ${token}` } })
        .then(res => res.json())
        .then(data => setMembers(Array.isArray(data) ? data : []))
        .catch(() => setMembers([]))
    } else {
      setMembers([])
    }
  }, [chat.id, chat.is_group, token])

  const resolvePartnerKey = useCallback(async (targetUserId) => {
    try {
      const r = await fetch(`/api/users/${targetUserId}/key`, { headers: { Authorization: `Bearer ${token}` } })
      if (r.ok) {
        const d = await r.json()
        return d.public_key
      }
    } catch {}
    return null
  }, [token])

  const showKeyBanner = useCallback((type, text) => {
    setKeyBanner({ type, text })
    setKeyInfoOpen(true)
    setTimeout(() => setKeyInfoOpen(false), 3500)
  }, [])

  const syncPartnerKey = useCallback(async (manual = false) => {
    if (chat.is_group || !partnerId) return
    if (manual) showKeyBanner('info', 'Синхронизируем ключи…')
    const pk = await resolvePartnerKey(partnerId)
    if (pk) {
      partnerKeyRef.current = pk
      setKeyStatus('ok')
      showKeyBanner('success', 'Ключи синхронизированы')
    } else {
      setKeyStatus('missing_partner')
      showKeyBanner('error', 'Ключ партнёра не найден')
    }
  }, [chat.is_group, partnerId, resolvePartnerKey, showKeyBanner])

  const recoverLocalKey = useCallback(async () => {
    if (!user?.encrypted_secret_key) {
      showKeyBanner('error', 'Нет резервной копии ключа. Войдите заново, чтобы создать ключи.')
      return
    }
    const password = window.prompt('Введите пароль для восстановления ключа')
    if (!password) return
    const recovered = await decryptKeyWithPassword(user.encrypted_secret_key, password)
    if (recovered) {
      localStorage.setItem(`chatik_sk_${user.id}`, recovered)
      setKeyStatus('ok')
      showKeyBanner('success', 'Ключ восстановлен')
    } else {
      showKeyBanner('error', 'Пароль неверен или ключ поврежден')
    }
  }, [showKeyBanner, user])

  const createNewKeys = useCallback(async () => {
    const password = window.prompt('Введите пароль для создания резервной копии ключа')
    if (!password) return
    try {
      const fresh = generateKeyPair()
      localStorage.setItem(`chatik_sk_${user.id}`, fresh.secretKey)
      const encryptedBackup = await encryptKeyWithPassword(fresh.secretKey, password)
      await fetch('/api/users/me/keys', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ public_key: fresh.publicKey, encrypted_secret_key: encryptedBackup })
      })
      setKeyStatus('ok')
      showKeyBanner('success', 'Ключи созданы и синхронизированы')
    } catch {
      showKeyBanner('error', 'Не удалось создать ключи')
    }
  }, [showKeyBanner, token, user])

  useEffect(() => {
    if (chat.is_group) {
      setKeyStatus('ok')
      return
    }
    if (!mySecretKey) {
      setKeyStatus('missing_local')
      return
    }
    if (partnerId) syncPartnerKey(false)
  }, [chat.id, chat.is_group, mySecretKey, partnerId, syncPartnerKey])

  const smartDecrypt = useCallback((encrypted, sessionKeyId, partnerPublicKey) => {
    if (!mySecretKey || !partnerPublicKey) return '[Ожидание ключа]'
    const skHistory = JSON.parse(localStorage.getItem(`chatik_sk_history_${user.id}`) || '[]')
    let result = '[Decryption failed]'
    if (sessionKeyId) {
      const sessionSK = skHistory.find(h => h.id === sessionKeyId)?.secretKey
      if (sessionSK) result = decryptMessage(encrypted, sessionSK, partnerPublicKey)
    }
    if (result === '[Decryption failed]' || result === '[Decryption crashed]') {
      result = decryptMessage(encrypted, mySecretKey, partnerPublicKey)
    }
    return result
  }, [mySecretKey, user?.id])

  const transformMessage = useCallback((m, currentPartnerKey) => {
    if (chat.is_group) {
      if (m.message_type === 'text') return { ...m, content: m.encrypted_content, reactions: m.reactions || [] }
      if (['image', 'audio', 'file'].includes(m.message_type)) return { ...m, isMedia: true }
      return { ...m, content: '[Неподдерживаемое сообщение]' }
    }

    if (m.message_type === 'text') {
      const cachedOwn = m.sender_id === user.id ? getCachedMessageText(m.id, m.client_id) : null
      if (cachedOwn) return { ...m, content: cachedOwn }
      const decrypted = smartDecrypt(m.encrypted_content, m.session_key_id, currentPartnerKey || partnerKeyRef.current)
      return { ...m, content: decrypted === '[Ожидание ключа]' ? 'Сообщение загружается...' : decrypted, reactions: m.reactions || [] }
    }
    if (['image', 'audio', 'file'].includes(m.message_type)) {
      return { ...m, isMedia: true, reactions: m.reactions || [] }
    }
    return { ...m, content: '[Неподдерживаемое сообщение]', reactions: m.reactions || [] }
  }, [chat.is_group, getCachedMessageText, smartDecrypt, user.id])

  const mergeMessages = useCallback((incoming) => {
    if (!Array.isArray(incoming) || !incoming.length) return
    setMessages(prev => {
      const map = new Map(prev.map(item => [item.id, item]))
      const byClientId = new Map(
        prev
          .filter(item => item.client_id)
          .map(item => [item.client_id, item])
      )
      for (const msg of incoming) {
        const existing = map.get(msg.id) || (msg.client_id ? byClientId.get(msg.client_id) : null)
        if (existing) {
          map.delete(existing.id)
          const next = { ...existing, ...msg }
          map.set(msg.id, next)
          if (next.client_id) byClientId.set(next.client_id, next)
        } else {
          map.set(msg.id, msg)
          if (msg.client_id) byClientId.set(msg.client_id, msg)
        }
      }
      return Array.from(map.values()).sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    })
  }, [])

  const loadHistory = useCallback(async () => {
    const pk = !chat.is_group && partnerId ? (partnerKeyRef.current || await resolvePartnerKey(partnerId)) : null
    if (pk) partnerKeyRef.current = pk

    const hist = await fetch(`/api/chats/${chat.id}/messages`, { headers: { Authorization: `Bearer ${token}` } })
    if (!hist.ok) return []

    const rawMsgs = await hist.json()
    if (rawMsgs.length) {
      lastServerMessageAtRef.current = rawMsgs[rawMsgs.length - 1].created_at
    } else {
      lastServerMessageAtRef.current = null
    }
    return rawMsgs.map(m => transformMessage(m, pk))
  }, [chat.id, chat.is_group, partnerId, resolvePartnerKey, token, transformMessage])

  const loadNewMessages = useCallback(async () => {
    const after = lastServerMessageAtRef.current
    if (!after) return []
    const pk = !chat.is_group && partnerId ? (partnerKeyRef.current || await resolvePartnerKey(partnerId)) : null
    if (pk) partnerKeyRef.current = pk

    const res = await fetch(`/api/chats/${chat.id}/messages/since?after=${encodeURIComponent(after)}&limit=120`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
    if (!res.ok) return []
    const raw = await res.json()
    if (raw.length) {
      lastServerMessageAtRef.current = raw[raw.length - 1].created_at
    }
    return raw.map(m => transformMessage(m, pk))
  }, [chat.id, chat.is_group, partnerId, resolvePartnerKey, token, transformMessage])

  useEffect(() => {
    let alive = true
    setMessages([])
    shouldAutoScrollRef.current = true
    lastMessageIdRef.current = null
    lastServerMessageAtRef.current = null

    loadHistory().then(history => {
      if (alive) setMessages(history)
    }).catch(() => {})

    return () => {
      alive = false
    }
  }, [loadHistory])

  const scrollToBottom = useCallback((behavior = 'auto') => {
    const el = messageListRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior })
  }, [])

  const handleMessageScroll = useCallback(() => {
    const el = messageListRef.current
    if (!el) return
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    shouldAutoScrollRef.current = distance < 120
  }, [])

  useEffect(() => {
    if (!messages.length) return
    const last = messages[messages.length - 1]
    const isMine = last?.sender_id === user.id
    const isNew = last?.id && last?.id !== lastMessageIdRef.current
    if (isNew && (shouldAutoScrollRef.current || isMine)) {
      requestAnimationFrame(() => scrollToBottom(isMine ? 'smooth' : 'auto'))
    }
    lastMessageIdRef.current = last?.id || null
  }, [messages, scrollToBottom, user.id])

  useEffect(() => {
    if (!messages.length) return
    const last = messages[messages.length - 1]
    if (!last) return
    if (String(last.id || '').startsWith('local_') || String(last.id || '').startsWith('local_file_')) return
    if (last.sender_id === user.id) return
    if (last.id === lastIncomingToneIdRef.current) return
    lastIncomingToneIdRef.current = last.id
    onIncomingMessageTone?.()
  }, [messages, onIncomingMessageTone, user.id])

  useEffect(() => {
    if (!messages.length) return
    const unreadIds = messages
      .filter(m => m.sender_id !== user.id && m.status !== 'read' && !String(m.id).startsWith('local_'))
      .map(m => m.id)

    if (unreadIds.length > 0) {
      setMessages(prev => prev.map(m => unreadIds.includes(m.id) ? { ...m, status: 'read' } : m))
      const ws = globalWsRef.current
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'read', chat_id: chat.id, message_ids: unreadIds }))
      }
      fetch(`/api/chats/${chat.id}/read`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ message_ids: unreadIds }),
      }).catch(() => {})
    }
  }, [messages, chat.id, globalWsRef, token, user.id])

  useEffect(() => {
    if (!Array.isArray(liveIncomingMessages) || liveIncomingMessages.length === 0) return
    let alive = true
    ;(async () => {
      if (!chat.is_group && !partnerKeyRef.current && partnerId) {
        const resolved = await resolvePartnerKey(partnerId)
        if (resolved) partnerKeyRef.current = resolved
      }
      if (!alive) return
      const prepared = []
      for (const lm of liveIncomingMessages) {
        if (lm.type === 'read' && lm.chat_id === chat.id) {
          setMessages(prev => prev.map(m => lm.message_ids.includes(m.id) ? { ...m, status: 'read' } : m))
        }
        if (lm.type === 'reaction' && lm.chat_id === chat.id && lm.message_id) {
          setMessages(prev => prev.map(m => m.id === lm.message_id ? { ...m, reactions: lm.reactions || [] } : m))
        }
        if (lm.type === 'typing' && lm.chat_id === chat.id && lm.user_id !== user.id) {
          if (lm.is_typing) {
            setTypingInfo({
              name: lm.user_name || (chat.is_group ? 'Пользователь' : partnerName),
              kind: lm.kind || 'typing',
              at: Date.now(),
            })
          } else {
            setTypingInfo(null)
          }
        }
        if (lm.type === 'message' && lm.chat_id === chat.id) {
          if (lm.created_at) lastServerMessageAtRef.current = lm.created_at
          prepared.push(transformMessage(lm, partnerKeyRef.current))
        }
      }
      mergeMessages(prepared)
    })()
    return () => {
      alive = false
    }
  }, [liveIncomingMessages, chat.id, chat.is_group, mergeMessages, partnerId, resolvePartnerKey, transformMessage])

  useEffect(() => {
    if (!typingInfo) return undefined
    const timer = setTimeout(() => {
      setTypingInfo(null)
    }, 2500)
    return () => clearTimeout(timer)
  }, [typingInfo])

  useEffect(() => {
    const handleOutside = (event) => {
      if (!mobileActionsRef.current) return
      if (!mobileActionsRef.current.contains(event.target)) {
        setMobileActionsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutside)
    document.addEventListener('touchstart', handleOutside, { passive: true })
    return () => {
      document.removeEventListener('mousedown', handleOutside)
      document.removeEventListener('touchstart', handleOutside)
    }
  }, [])

  useEffect(() => {
    setMobileActionsOpen(false)
  }, [chat?.id])

  useEffect(() => {
    const poll = async () => {
      if (historyLoadingRef.current) return
      historyLoadingRef.current = true
      try {
        const delta = await loadNewMessages()
        mergeMessages(delta)
      } catch {} finally {
        historyLoadingRef.current = false
      }
    }
    pollingRef.current = setInterval(poll, wsConnected ? 1500 : 900)
    return () => clearInterval(pollingRef.current)
  }, [chat.id, wsConnected, loadNewMessages, mergeMessages])

  const openActionsForMessage = (msg) => {
    setActiveMessage(msg)
    setShowActionSheet(true)
  }

  const closeActionSheet = () => {
    setShowActionSheet(false)
    setTimeout(() => setActiveMessage(null), 120)
  }

  const onMessageContext = (e, msg, doubleOnly = false) => {
    e.preventDefault()
    if (doubleOnly) return
    openActionsForMessage(msg)
  }

  const onMessageClick = (e, msg, doubleOnly = false) => {
    if (doubleOnly) return
    const sel = window.getSelection?.()?.toString?.() || ''
    if (sel && sel.trim().length > 0) return
    const isDecryptFailed = msg?.message_type === 'text' && (
      msg?.content === '[Decryption failed]' ||
      msg?.content === '[Decryption crashed]' ||
      msg?.content === 'Сообщение загружается...'
    )
    if (isDecryptFailed) {
      retryDecryptMessage(msg).catch(() => {})
      return
    }
    openActionsForMessage(msg)
  }

  const onMessageDoubleClick = (e, msg) => {
    e.preventDefault()
    e.stopPropagation()
    openActionsForMessage(msg)
  }

  const onMessageTouchStart = (msg, doubleOnly = false) => {
    if (doubleOnly) return
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current)
    holdTimerRef.current = setTimeout(() => {
      openActionsForMessage(msg)
    }, 520)
  }

  const onMessageTouchEnd = (msg, doubleOnly = false) => {
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current)
    if (!doubleOnly) return
    const now = Date.now()
    if (lastTapRef.current.id === msg.id && now - lastTapRef.current.ts < 320) {
      openActionsForMessage(msg)
      lastTapRef.current = { id: null, ts: 0 }
      return
    }
    lastTapRef.current = { id: msg.id, ts: now }
  }

  const sendViaApi = async ({ encryptedContent, messageType = 'text', fileId = null, sessionKeyId = null, clientId = null }) => {
    const res = await fetch(`/api/chats/${chat.id}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        encrypted_content: encryptedContent,
        message_type: messageType,
        file_id: fileId,
        session_key_id: sessionKeyId,
        client_id: clientId
      })
    })

    if (!res.ok) throw new Error('send_failed')
    const data = await res.json()
    return data.message
  }

  const updateLocalMessage = useCallback((localId, patch) => {
    setMessages(prev => prev.map(m => m.id === localId ? { ...m, ...patch } : m))
  }, [])

  const uploadEncryptedFile = useCallback((form, onProgress) => new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/files/upload')
    xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100))
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText))
        } catch (err) {
          reject(err)
        }
      } else {
        let message = 'upload_failed'
        try {
          const parsed = JSON.parse(xhr.responseText || '{}')
          message = parsed.error || parsed.message || message
        } catch {}
        reject(new Error(message))
      }
    }
    xhr.onerror = () => reject(new Error('upload_failed'))
    xhr.send(form)
  }), [token])

  const sendMessage = async (e) => {
    e?.preventDefault()
    const text = inputText.trim()
    if (!text) return

    let composedText = text
    if (replyTo?.text) {
      const replyId = replyTo.id ? `[[reply:${replyTo.id}]]\n` : ''
      composedText = `${replyId}> ${replyTo.name || 'Ответ'}: ${replyTo.text}\n\n${text}`
    }

    let encrypted = composedText
    let myCurrentSkId = null

    if (!chat.is_group) {
      if (!mySecretKey) {
        setKeyStatus('missing_local')
        showKeyBanner('error', 'Нет локального ключа. Восстановите ключи.')
        return
      }
      const targetPK = partnerKeyRef.current || await resolvePartnerKey(partnerId)
      if (!targetPK) {
        setKeyStatus('missing_partner')
        showKeyBanner('error', 'Ключ партнёра не найден. Синхронизируйте ключи.')
        return
      }
      encrypted = encryptMessage(encrypted, mySecretKey, targetPK)
      myCurrentSkId = localStorage.getItem(`chatik_current_sk_id_${user.id}`)
    }

    if (editingMessage) {
      try {
        let editPayload = encrypted
        if (chat.is_group) editPayload = composedText
        const res = await fetch(`/api/chats/${chat.id}/messages/${editingMessage.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ encrypted_content: editPayload }),
        })
        if (res.ok) {
          const data = await res.json()
          cacheMessageText(editingMessage.id, composedText, editingMessage.client_id)
          setMessages(prev => prev.map(m => m.id === editingMessage.id ? transformMessage({ ...data.message, content: composedText }, partnerKeyRef.current) : m))
          setEditingMessage(null)
          setInputText('')
          restoreInputFocus()
          setReplyTo(null)
        }
      } catch {}
      return
    }

    const localId = `local_${Date.now()}`
    const optimisticMessage = {
      id: localId,
      client_id: localId,
      chat_id: chat.id,
      sender_id: user.id,
      message_type: 'text',
      content: composedText,
      encrypted_content: encrypted,
      created_at: new Date().toISOString(),
      status: 'sent',
      sender_name: user.display_name,
      session_key_id: myCurrentSkId
    }

    cacheMessageText(localId, composedText, localId)
    setMessages(prev => [...prev, optimisticMessage])
    setInputText('')
    restoreInputFocus()
    try { localStorage.removeItem(draftKey) } catch {}
    setShowEmoji(false)
    setReplyTo(null)

    try {
      let serverMessage = null
      const ws = globalWsRef.current
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({
          type: 'message',
          client_id: localId,
          chat_id: chat.id,
          encrypted_content: encrypted,
          message_type: 'text',
          session_key_id: myCurrentSkId
        }))
        onOutgoingMessageTone?.()
        return
      }

      serverMessage = await sendViaApi({ encryptedContent: encrypted, messageType: 'text', sessionKeyId: myCurrentSkId, clientId: localId })
      if (serverMessage?.id) {
        cacheMessageText(serverMessage.id, composedText, localId)
        setMessages(prev => prev.map(m => m.id === localId ? transformMessage({ ...serverMessage, content: composedText }, partnerKeyRef.current) : m))
      }
      onOutgoingMessageTone?.()
    } catch {
      setMessages(prev => prev.map(m => m.id === localId ? { ...m, status: 'error' } : m))
    }
  }

  const handleDeleteMessage = async (msg) => {
    if (!msg) return
    if (!window.confirm('Удалить сообщение?')) return
    try {
      const res = await fetch(`/api/chats/${chat.id}/messages/${msg.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        setMessages(prev => prev.filter(m => m.id !== msg.id))
      }
    } catch {}
  }

  const handleCopyMessage = async (msg) => {
    if (!msg) return
    const text = msg.content || ''
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      try {
        const textarea = document.createElement('textarea')
        textarea.value = text
        document.body.appendChild(textarea)
        textarea.select()
        document.execCommand('copy')
        textarea.remove()
      } catch {}
    }
  }

  const toggleReaction = async (emoji) => {
    if (!activeMessage) return
    const ws = globalWsRef.current
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'reaction', chat_id: chat.id, message_id: activeMessage.id, emoji }))
      return
    }
    try {
      const res = await fetch(`/api/chats/${chat.id}/messages/${activeMessage.id}/reactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ emoji }),
      })
      if (res.ok) {
        const data = await res.json()
        setMessages(prev => prev.map(m => m.id === activeMessage.id ? { ...m, reactions: data.reactions || [] } : m))
      }
    } catch {}
  }

  const handleForward = async (msg, target) => {
    if (!msg || !target) return
    if (msg.message_type !== 'text') {
      alert('Пересылка медиа пока недоступна')
      return
    }
    try {
      const res = await fetch('/api/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ partner_id: target.id })
      })
      if (!res.ok) return
      const data = await res.json()
      const chatId = data.chat_id
      let payloadText = msg.content || ''
      let encrypted = payloadText
      let sessionKeyId = null
      if (!data.chat?.is_group) {
        const targetPK = await resolvePartnerKey(target.id)
        if (targetPK && mySecretKey) {
          encrypted = encryptMessage(payloadText, mySecretKey, targetPK)
          sessionKeyId = localStorage.getItem(`chatik_current_sk_id_${user.id}`)
        }
      }
      await fetch(`/api/chats/${chatId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          encrypted_content: encrypted,
          message_type: 'text',
          session_key_id: sessionKeyId,
          client_id: `fwd_${Date.now()}`
        })
      })
      setForwardModal(false)
    } catch {}
  }

  const loadForwardTargets = async () => {
    try {
      const [chatsRes, usersRes] = await Promise.all([
        fetch('/api/chats', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/users/search', { headers: { Authorization: `Bearer ${token}` } })
      ])
      const chatsData = chatsRes.ok ? await chatsRes.json() : []
      const usersData = usersRes.ok ? await usersRes.json() : []
      setForwardTargets({
        chats: chatsData.filter(c => !c.is_group),
        users: usersData,
      })
    } catch {}
  }

  const sendEncryptedFileMessage = async (file, messageType) => {
    if (!file) return
    setUploading(true)
    setUploadStatus({ stage: 'Подготовка...', progress: 0, type: messageType })
    const localId = `local_file_${Date.now()}`
    try {
      let encryptedBlob = file
      let payloadMeta = {
        name: file.name,
        type: file.type || 'application/octet-stream',
        size: file.size,
      }
      let sessionKeyId = null
      let localPreviewUrl = ['audio', 'image'].includes(messageType) ? URL.createObjectURL(file) : null

      setMessages(prev => [...prev, {
        id: localId,
        client_id: localId,
        chat_id: chat.id,
        sender_id: user.id,
        message_type: messageType,
        encrypted_content: JSON.stringify(payloadMeta),
        isMedia: true,
        created_at: new Date().toISOString(),
        status: 'uploading',
        uploadStage: 'Подготовка...',
        uploadProgress: 0,
        sender_name: user.display_name,
        file_id: null,
        localPreviewUrl,
      }])

      if (!chat.is_group) {
        updateLocalMessage(localId, { uploadStage: 'Шифрование...', uploadProgress: 5 })
        setUploadStatus({ stage: 'Шифрование...', progress: 5, type: messageType })
        const targetPK = partnerKeyRef.current || await resolvePartnerKey(partnerId)
        if (!targetPK || !mySecretKey) throw new Error('missing_keys')
        const fileBuffer = await file.arrayBuffer()
        const encrypted = await encryptFile(fileBuffer, mySecretKey, targetPK)
        encryptedBlob = encrypted.encryptedBlob
        payloadMeta = { ...payloadMeta, iv: encrypted.iv, wrappedKey: encrypted.wrappedKey }
        sessionKeyId = localStorage.getItem(`chatik_current_sk_id_${user.id}`)
        updateLocalMessage(localId, { encrypted_content: JSON.stringify(payloadMeta), uploadProgress: 20 })
      }

      const form = new FormData()
      form.append('file', encryptedBlob, file.name)
      updateLocalMessage(localId, { uploadStage: 'Загрузка...', uploadProgress: 25 })
      setUploadStatus({ stage: 'Загрузка...', progress: 25, type: messageType })
      const uploadData = await uploadEncryptedFile(form, (progress) => {
        updateLocalMessage(localId, { uploadStage: 'Загрузка...', uploadProgress: Math.max(25, progress) })
        setUploadStatus({ stage: 'Загрузка...', progress: Math.max(25, progress), type: messageType })
      })

      let created = null
      const ws = globalWsRef.current
      updateLocalMessage(localId, { uploadStage: 'Отправка...', uploadProgress: 100 })
      setUploadStatus({ stage: 'Отправка...', progress: 100, type: messageType })
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({
          type: 'message',
          client_id: localId,
          chat_id: chat.id,
          encrypted_content: JSON.stringify(payloadMeta),
          message_type: messageType,
          file_id: uploadData.file_id,
          session_key_id: sessionKeyId,
        }))
        onOutgoingMessageTone?.()
      } else {
        created = await sendViaApi({
          encryptedContent: JSON.stringify(payloadMeta),
          messageType,
          fileId: uploadData.file_id,
          sessionKeyId,
          clientId: localId,
        })
      }

      if (created) {
        setMessages(prev => prev.map(m => m.id === localId ? transformMessage({ ...created, localPreviewUrl: m.localPreviewUrl }, partnerKeyRef.current) : m))
        onOutgoingMessageTone?.()
      }
    } catch (error) {
      setMessages(prev => prev.map(m => m.id === localId ? { ...m, status: 'error' } : m))
      const message = error?.message === 'request entity too large'
        ? 'Файл слишком большой'
        : (error?.message === 'upload_failed' ? 'Ошибка отправки' : error?.message || 'Ошибка отправки')
      setUploadStatus({ stage: message, progress: 0, type: messageType, error: true })
    } finally {
      setUploading(false)
      setTimeout(() => setUploadStatus(null), 2400)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleFileSelected = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const messageType = file.type.startsWith('image/') ? 'image' : (file.type.startsWith('audio/') ? 'audio' : 'file')
    await sendEncryptedFileMessage(file, messageType)
  }

  const startRecording = async () => {
    if (isRecording || uploading) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm'
      const recorder = new MediaRecorder(stream, { mimeType })
      recordingChunksRef.current = []
      recorder.ondataavailable = (event) => {
        if (event.data?.size) recordingChunksRef.current.push(event.data)
      }
      recorder.onstop = async () => {
        const audioBlob = new Blob(recordingChunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        stream.getTracks().forEach(track => track.stop())
        setIsRecording(false)
        if (audioBlob.size) {
          const ext = audioBlob.type.includes('ogg') ? 'ogg' : 'webm'
          const voiceFile = new File([audioBlob], `voice-${Date.now()}.${ext}`, { type: audioBlob.type || 'audio/webm' })
          await sendEncryptedFileMessage(voiceFile, 'audio')
        }
      }
      mediaRecorderRef.current = recorder
      recorder.start()
      setIsRecording(true)
    } catch {}
  }

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
  }

  const clearChat = async () => {
    const res = await fetch(`/api/chats/${chat.id}/clear`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    })
    if (res.ok) setMessages([])
  }

  const deleteChat = async () => {
    const title = chat.is_group ? (chat.group_name || 'эту группу') : (partnerName || 'этот чат')
    if (!window.confirm(chat.is_group ? `Удалить группу "${title}"?` : `Удалить чат с "${title}"?`)) return
    const res = await fetch(`/api/chats/${chat.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    })
    if (res.ok) {
      onBack?.()
      onChatDeleted?.()
    } else {
      const text = await res.text().catch(() => '')
      let message = chat.is_group ? 'Не удалось удалить группу' : 'Не удалось удалить чат'
      try {
        const parsed = JSON.parse(text || '{}')
        message = parsed.error || message
      } catch {
        if (text) message = text
      }
      alert(message)
    }
  }

  const formatTime = (iso) => {
    try {
      return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    } catch {
      return ''
    }
  }

  const restoreInputFocus = () => {
    const isMobileViewport = window.matchMedia?.('(max-width: 900px)')?.matches
    if (!isMobileViewport) return
    setTimeout(() => {
      try {
        inputRef.current?.focus({ preventScroll: true })
      } catch {
        inputRef.current?.focus()
      }
    }, 30)
  }

  const sendTyping = useCallback((isTyping, kind = 'typing') => {
    const ws = globalWsRef.current
    if (!ws || ws.readyState !== 1 || !chat?.id) return
    ws.send(JSON.stringify({
      type: 'typing',
      chat_id: chat.id,
      is_typing: isTyping,
      kind,
      user_name: user?.display_name || user?.username || 'Пользователь',
    }))
  }, [chat?.id, globalWsRef, user?.display_name, user?.username])

  useEffect(() => {
    if (!chat?.id || isRecording) return
    if (!inputText.trim()) {
      if (typingLastSentRef.current === 'typing') {
        sendTyping(false, 'typing')
        typingLastSentRef.current = null
      }
      return
    }
    if (typingLastSentRef.current !== 'typing') {
      sendTyping(true, 'typing')
      typingLastSentRef.current = 'typing'
    }
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
    typingTimeoutRef.current = setTimeout(() => {
      sendTyping(false, 'typing')
      typingLastSentRef.current = null
    }, 900)
    return () => {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
    }
  }, [inputText, isRecording, sendTyping, chat?.id])

  useEffect(() => {
    return () => {
      if (typingLastSentRef.current) {
        sendTyping(false, typingLastSentRef.current)
        typingLastSentRef.current = null
      }
    }
  }, [sendTyping])

  useEffect(() => {
    if (!chat?.id) return
    if (!isRecording) return
    sendTyping(true, 'recording')
    typingLastSentRef.current = 'recording'
    return () => {
      sendTyping(false, 'recording')
      typingLastSentRef.current = null
    }
  }, [isRecording, sendTyping, chat?.id])

  const retryDecryptMessage = useCallback(async (msg) => {
    if (!msg || chat.is_group || msg.message_type !== 'text') return false
    const freshPartnerKey = partnerId ? await resolvePartnerKey(partnerId) : null
    if (freshPartnerKey) partnerKeyRef.current = freshPartnerKey
    const decrypted = smartDecrypt(msg.encrypted_content, msg.session_key_id, freshPartnerKey || partnerKeyRef.current)
    if (decrypted && decrypted !== '[Decryption failed]' && decrypted !== '[Decryption crashed]' && decrypted !== '[Ожидание ключа]') {
      setMessages(prev => prev.map(item => item.id === msg.id ? { ...item, content: decrypted } : item))
      return true
    }
    showKeyBanner('error', 'Не удалось расшифровать. Нажмите ключ в шапке для синхронизации.')
    return false
  }, [chat.is_group, partnerId, resolvePartnerKey, showKeyBanner, smartDecrypt])

  const renderHeaderActions = (isMobileMenu = false) => (
    <>
      <button
        className={`btn search-toggle-btn${isMobileMenu ? ' mobile-menu-action' : ''}`}
        onClick={() => { setShowSearch(prev => !prev); setMobileActionsOpen(false) }}
        style={{ background: 'transparent', padding: '5px', color: 'var(--text-dim)', border: 'none' }}
        title="Поиск"
      >
        <Search size={18} />
        {isMobileMenu && <span>Поиск</span>}
      </button>
      <button
        className={`btn clear-chat-btn${isMobileMenu ? ' mobile-menu-action' : ''}`}
        onClick={() => { clearChat(); setMobileActionsOpen(false) }}
        style={{ background: 'transparent', padding: '5px', color: '#f7768e', border: 'none' }}
        title="Очистить"
      >
        <Trash2 size={20} />
        {isMobileMenu && <span>Очистить чат</span>}
      </button>
      <button
        className={`btn${isMobileMenu ? ' mobile-menu-action' : ''}`}
        onClick={() => { deleteChat(); setMobileActionsOpen(false) }}
        style={{ background: 'rgba(248, 113, 113, 0.16)', color: '#f87171', padding: '8px', borderRadius: '10px' }}
        title={chat.is_group ? 'Удалить группу' : 'Удалить чат'}
      >
        <XCircle size={18} />
        {isMobileMenu && <span>{chat.is_group ? 'Удалить группу' : 'Удалить чат'}</span>}
      </button>
      {!chat.is_group && (
        <>
          <button
            className={`btn call-audio-btn${isMobileMenu ? ' mobile-menu-action' : ''}`}
            onClick={() => { onInitiateCall(callPartner, false); setMobileActionsOpen(false) }}
            style={{ background: 'rgba(56, 189, 248, 0.1)', color: 'var(--primary)', padding: '8px', borderRadius: '10px' }}
            title={wsConnected ? 'Аудиозвонок' : 'Аудиозвонок (fallback без сокета)'}
          >
            <Phone size={20} />
            {isMobileMenu && <span>Аудиозвонок</span>}
          </button>
          <button
            className={`btn call-video-btn${isMobileMenu ? ' mobile-menu-action' : ''}`}
            onClick={() => { onInitiateCall(callPartner, true); setMobileActionsOpen(false) }}
            style={{ background: 'rgba(56, 189, 248, 0.1)', color: 'var(--primary)', padding: '8px', borderRadius: '10px' }}
            title={wsConnected ? 'Видеозвонок' : 'Видеозвонок (fallback без сокета)'}
          >
            <Video size={20} />
            {isMobileMenu && <span>Видеозвонок</span>}
          </button>
        </>
      )}
    </>
  )

  return (
    <div className={`chat-window ${compactMode ? 'compact-mode' : ''} ${animations ? 'motion-on' : 'motion-off'} ${bubbleStyle === 'sharp' ? 'bubble-sharp' : 'bubble-rounded'}`}>
      <div className="chat-header">
        <button className="btn mobile-only" onClick={onBack} style={{ background: 'transparent', padding: '5px', color: 'var(--text-dim)', border: 'none', marginRight: '10px' }}><ArrowLeft size={24} /></button>
        <div className="chat-header-main">
          {chat.is_group ? (
            <div className="chat-header-avatar chat-header-group"><Users size={20} /></div>
          ) : (
            <div className={`chat-header-avatar ${partnerAvatarUrl ? 'has-photo' : ''} ${partnerOnline ? 'is-online' : ''}`} style={{ backgroundColor: partnerAvatarUrl ? 'transparent' : partnerAvatar }}>
              {partnerAvatarUrl ? <img src={partnerAvatarUrl} alt={partnerName} /> : partnerName.charAt(0).toUpperCase()}
            </div>
          )}
          <div>
            <div className="chat-header-title-row">
              <div className="chat-header-title">{chat.is_group ? chat.group_name : partnerName}</div>
              {!chat.is_group && (
                <button
                  type="button"
                  className={`key-status-chip ${keyStatus === 'ok' ? 'ok' : 'warn'}`}
                  onClick={async () => {
                    if (keyStatus === 'missing_local') {
                      if (user?.encrypted_secret_key) {
                        await recoverLocalKey()
                      } else {
                        await createNewKeys()
                      }
                      return
                    }
                    await syncPartnerKey(true)
                    let text = 'Проверяем ключи...'
                    if (keyStatus === 'ok') text = 'Ключи синхронизированы'
                    if (keyStatus === 'missing_local') {
                      text = user?.encrypted_secret_key
                        ? 'Нет локального ключа. Нужна восстановление.'
                        : 'Нет локального ключа. Войдите заново, чтобы создать ключи.'
                    }
                    if (keyStatus === 'missing_partner') text = 'Ключ партнёра не найден. Нажмите синхронизацию.'
                    setKeyBanner({ type: keyStatus === 'ok' ? 'success' : 'info', text })
                    setKeyInfoOpen(true)
                    setTimeout(() => setKeyInfoOpen(false), 3500)
                  }}
                  title="Статус ключей"
                >
                  <KeyRound size={12} />
                </button>
              )}
            </div>
            {typingInfo ? (
              <div className="chat-header-status online" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span className="typing-dot-mini" style={{ animationDelay: '0s' }} />
                <span className="typing-dot-mini" style={{ animationDelay: '0.2s' }} />
                <span className="typing-dot-mini" style={{ animationDelay: '0.4s' }} />
                <span>{typingInfo.kind === 'recording' ? 'записывает голосовое…' : 'печатает…'}</span>
              </div>
            ) : (
              <div className={`chat-header-status ${partnerOnline ? 'online' : ''}`}>
                {chat.is_group ? `${members.length} участников` : (partnerOnline ? 'В сети' : 'Оффлайн')}
              </div>
            )}
            {!chat.is_group && !partnerOnline && !typingInfo && lastSeenLabel && (
              <div className="chat-header-lastseen">{lastSeenLabel}</div>
            )}
            {!chat.is_group && keyInfoOpen && keyBanner?.text && (
              <div className="key-info-text">{keyBanner.text}</div>
            )}

            {showSearch && (
              <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Search size={14} color="var(--text-dim)" />
                <input
                  className="input"
                  style={{ height: 32, padding: '6px 10px', fontSize: '0.82rem', width: 200 }}
                  placeholder="Поиск в чате"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                <button className="icon-btn subtle-btn" style={{ width: 30, height: 30 }} onClick={() => { setSearchQuery(''); setShowSearch(false) }}>
                  <X size={14} />
                </button>
              </div>
            )}
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <div className="chat-header-actions desktop-only">
          {renderHeaderActions(false)}
        </div>
        <div className="mobile-header-actions mobile-only" ref={mobileActionsRef}>
          <button
            type="button"
            className="btn mobile-actions-toggle"
            onClick={() => setMobileActionsOpen(prev => !prev)}
            title="Действия чата"
          >
            <span className="mobile-menu-glyph">⋮</span>
          </button>
          {mobileActionsOpen && (
            <div className="mobile-actions-menu">
              {renderHeaderActions(true)}
            </div>
          )}
        </div>
      </div>

      <div className="chat-messages" ref={messageListRef} onScroll={handleMessageScroll}>
        {(searchQuery ? messages.filter(m => (m.content || '').toLowerCase().includes(searchQuery.toLowerCase())) : messages).map((m, i, arr) => {
          const isMine = m.sender_id === user.id
          const emojiOnly = isEmojiOnlyText(m.content)
          const mediaKind = getMediaKind(m)
          const useDoubleOnlyMenu = emojiOnly || mediaKind === 'image' || mediaKind === 'video'
          const showSender = chat.is_group && !isMine && (i === 0 || arr[i - 1].sender_id !== m.sender_id)
          return (
            <div
              key={m.id}
              id={`message-${m.id}`}
              className={`message-row ${isMine ? 'mine' : 'theirs'} ${animations ? 'animate-in' : ''}`}
              onContextMenu={(e) => onMessageContext(e, m, useDoubleOnlyMenu)}
              onClick={(e) => onMessageClick(e, m, useDoubleOnlyMenu)}
              onDoubleClick={(e) => useDoubleOnlyMenu ? onMessageDoubleClick(e, m) : undefined}
              onTouchStart={() => onMessageTouchStart(m, useDoubleOnlyMenu)}
              onTouchEnd={() => onMessageTouchEnd(m, useDoubleOnlyMenu)}
            >
              {showSender && <div style={{ fontSize: '0.75rem', color: 'var(--primary)', marginLeft: '10px', marginBottom: '4px' }}>{m.sender_name}</div>}
              <div className={`message-bubble ${isMine ? 'mine' : 'theirs'} ${m.status === 'error' ? 'error' : ''} ${emojiOnly ? 'emoji-only' : ''} ${(mediaKind === 'image' || mediaKind === 'video') ? 'media-plain' : ''}`}>
                {m.message_type === 'text' && renderMessageText(m.content, (replyId) => {
                  if (!replyId) return
                  const target = document.getElementById(`message-${replyId}`)
                  if (target) {
                    target.scrollIntoView({ behavior: 'smooth', block: 'center' })
                  }
                })}
                {m.isMedia && <MediaBubble msg={m} token={token} mySecretKey={mySecretKey} partnerKey={partnerKeyRef.current} isGroup={chat.is_group} isMine={isMine} />}
                <ReactionBar
                  msg={m}
                  onToggle={(emoji) => {
                    setActiveMessage(m)
                    toggleReaction(emoji)
                  }}
                />
              </div>
              <div className="message-meta message-meta-outer">
                {formatTime(m.created_at)}
                {isMine && (
                  m.status === 'error' ? <span title="Не отправлено" style={{ color: '#f7768e', fontWeight: 700 }}>!</span> :
                  (m.status === 'read' ? <CheckCheck size={14} color="#38bdf8" /> : <Check size={14} />)
                )}
              </div>
            </div>
          )
        })}
        {typingInfo && (
          <div className="typing-bubble-row">
            {!chat.is_group && (
              <div
                className={`typing-avatar-mini ${partnerAvatarUrl ? 'has-photo' : ''}`}
                style={{ backgroundColor: partnerAvatarUrl ? 'transparent' : partnerAvatar }}
              >
                {partnerAvatarUrl
                  ? <img src={partnerAvatarUrl} alt={partnerName} />
                  : partnerName.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="typing-bubble">
              <span className="typing-dot" />
              <span className="typing-dot" />
              <span className="typing-dot" />
              {typingInfo.kind === 'recording' && (
                <span className="typing-label">голосовое</span>
              )}
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {false && keyBanner && null}

      <div className="chat-input-bar">
        {uploadStatus && (
          <div style={{
            position: 'absolute',
            left: '20px',
            right: '20px',
            bottom: '76px',
            padding: '10px 12px',
            borderRadius: '14px',
            background: 'rgba(17, 24, 39, 0.94)',
            border: `1px solid ${uploadStatus.error ? 'rgba(247,118,142,0.45)' : 'rgba(56,189,248,0.22)'}`,
            boxShadow: 'var(--shadow-sm)',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            zIndex: 30,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: '0.82rem' }}>
              <span>{uploadStatus.type === 'audio' ? 'Голосовое сообщение' : 'Вложение'}: {uploadStatus.stage}</span>
              <span>{uploadStatus.progress || 0}%</span>
            </div>
            <div style={{ width: '100%', height: 6, borderRadius: 999, background: 'rgba(255,255,255,0.1)', overflow: 'hidden' }}>
              <div style={{
                width: `${uploadStatus.progress || 0}%`,
                height: '100%',
                background: uploadStatus.error ? '#f7768e' : 'linear-gradient(90deg, #38bdf8 0%, #60a5fa 100%)',
                transition: 'width 0.2s ease',
              }} />
            </div>
          </div>
        )}
        {showEmoji && (
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 120 }}
            onClick={() => setShowEmoji(false)}
          >
            <div
              style={{ position: 'absolute', bottom: '80px', left: '20px', zIndex: 121 }}
              onClick={(e) => e.stopPropagation()}
            >
              <EmojiPicker onEmojiClick={(ed) => setInputText(p => p + ed.emoji)} theme="dark" />
            </div>
          </div>
        )}
        <button className="btn composer-tool" style={{ background: 'transparent', padding: '0' }} onClick={() => setShowEmoji(!showEmoji)}><Smile color={showEmoji ? 'var(--primary)' : 'var(--text-dim)'} /></button>
        <button className="btn composer-tool" style={{ background: 'transparent', padding: '0' }} onClick={() => fileInputRef.current?.click()} disabled={uploading}><Paperclip color={uploading ? 'var(--primary)' : 'var(--text-dim)'} /></button>
        <button className="btn composer-tool" style={{ background: 'transparent', padding: '0' }} onClick={isRecording ? stopRecording : startRecording} disabled={uploading} title={isRecording ? 'Остановить запись' : 'Голосовое сообщение'}>
          {isRecording ? <Square color="#f7768e" /> : <Mic color={uploading ? 'var(--primary)' : 'var(--text-dim)'} />}
        </button>
        <input type="file" ref={fileInputRef} style={{ display: 'none' }} onChange={handleFileSelected} />
        <form onSubmit={sendMessage} className="composer-form" style={{ display: 'flex', flex: 1, gap: '10px' }}>
          <input ref={inputRef} type="text" className="input composer-input" style={{ flex: 1, border: 'none', background: 'var(--bg-dark)' }} placeholder={isRecording ? 'Идет запись голосового сообщения...' : (keyStatus !== 'ok' && !chat.is_group ? 'Нужна синхронизация ключей...' : 'Напишите сообщение...')} value={inputText} onChange={e => setInputText(e.target.value)} disabled={isRecording || (keyStatus !== 'ok' && !chat.is_group)} />
          <button type="submit" className="btn composer-send" style={{ padding: '10px' }} disabled={isRecording || (keyStatus !== 'ok' && !chat.is_group)}><Send size={18} /></button>
        </form>
      </div>

      {(editingMessage || replyTo) && (
        <div style={{ position: 'absolute', left: 20, right: 20, bottom: 82, background: 'rgba(15,20,34,0.95)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 10, zIndex: 50 }}>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>
            {editingMessage ? 'Редактирование' : `Ответ: ${replyTo?.name || ''}`}
          </div>
          <div style={{ flex: 1, fontSize: '0.8rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {editingMessage?.content || replyTo?.text}
          </div>
          <button className="icon-btn subtle-btn" style={{ width: 30, height: 30 }} onClick={() => { setEditingMessage(null); setReplyTo(null); }}>
            <X size={14} />
          </button>
        </div>
      )}

      {showActionSheet && activeMessage && (
        <div className="message-sheet-overlay" onClick={closeActionSheet}>
          <div className="message-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="message-sheet-reactions">
              {['👍', '❤️', '😂', '😮', '😡', '😢', '🤢'].map(emoji => (
                <button key={emoji} type="button" onClick={() => { toggleReaction(emoji); closeActionSheet(); }}>
                  {emoji}
                </button>
              ))}
            </div>
            <div className="message-sheet-actions">
              <button onClick={() => { setReplyTo({ id: activeMessage.id, name: activeMessage.sender_name, text: activeMessage.content }); closeActionSheet(); }}>
                <Reply size={16} /> Ответить с цитатой
              </button>
              <button onClick={() => { handleCopyMessage(activeMessage); closeActionSheet(); }}>
                <Copy size={16} /> Копировать
              </button>
              <button onClick={() => { setForwardModal(true); loadForwardTargets(); closeActionSheet(); }}>
                <Forward size={16} /> Переслать
              </button>
              <button
                disabled={!(activeMessage.sender_id === user.id && activeMessage.message_type === 'text')}
                title={activeMessage.sender_id === user.id ? 'Изменить сообщение' : 'Можно менять только свои сообщения'}
                onClick={() => { setEditingMessage(activeMessage); setInputText(activeMessage.content || ''); closeActionSheet(); }}
                style={{ opacity: activeMessage.sender_id === user.id && activeMessage.message_type === 'text' ? 1 : 0.45, cursor: activeMessage.sender_id === user.id && activeMessage.message_type === 'text' ? 'pointer' : 'not-allowed' }}
              >
                <Edit3 size={16} /> Изменить
              </button>
              <button
                disabled={activeMessage.sender_id !== user.id}
                title={activeMessage.sender_id === user.id ? 'Удалить сообщение' : 'Можно удалять только свои сообщения'}
                onClick={() => { handleDeleteMessage(activeMessage); closeActionSheet(); }}
                style={{ opacity: activeMessage.sender_id === user.id ? 1 : 0.45, cursor: activeMessage.sender_id === user.id ? 'pointer' : 'not-allowed' }}
              >
                <Trash2 size={16} /> Удалить
              </button>
            </div>
          </div>
        </div>
      )}

      {forwardModal && (
        <div className="message-sheet-overlay" onClick={() => setForwardModal(false)}>
          <div className="message-sheet forward-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="forward-title">Переслать пользователю</div>
            <div className="forward-list">
              {forwardTargets.users.filter(u => u.id !== user?.id).map(u => (
                <button key={u.id} onClick={() => handleForward(activeMessage, u)}>
                  {u.display_name} <span>@{u.username}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function renderMessageText(text, onQuoteClick) {
  if (!text) return <div style={{ fontSize: '0.95rem' }} />
  const marker = '\n\n'
  let replyId = null
  let cleaned = text
  if (cleaned.startsWith('[[reply:')) {
    const end = cleaned.indexOf(']]')
    if (end !== -1) {
      replyId = cleaned.slice(8, end)
      cleaned = cleaned.slice(end + 2)
      if (cleaned.startsWith('\n')) cleaned = cleaned.slice(1)
    }
  }
  if (cleaned.startsWith('> ') && cleaned.includes(marker)) {
    const splitIndex = cleaned.indexOf(marker)
    const quote = cleaned.slice(2, splitIndex)
    const body = cleaned.slice(splitIndex + marker.length)
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div
          className="message-quote"
          onClick={(e) => {
            e.stopPropagation()
            onQuoteClick?.(replyId)
          }}
          onContextMenu={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
          onTouchStart={(e) => {
            e.stopPropagation()
          }}
          title={replyId ? 'Перейти к сообщению' : ''}
        >
          {quote}
        </div>
        <div style={{ fontSize: '0.95rem' }}>{body}</div>
      </div>
    )
  }
  return <div style={{ fontSize: '0.95rem' }}>{cleaned}</div>
}

function isEmojiOnlyText(text) {
  if (!text) return false
  const cleaned = String(text)
    .replace(/\[\[reply:[^\]]+\]\]\s*/g, '')
    .replace(/^>.*$/gm, '')
    .trim()
  if (!cleaned) return false
  const noSpaces = cleaned.replace(/\s+/g, '')
  const emojiOnly = /^[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Emoji_Component}\u200D\uFE0F]+$/u.test(noSpaces)
  if (!emojiOnly) return false
  const emojiCount = (noSpaces.match(/\p{Extended_Pictographic}/gu) || []).length
  return emojiCount >= 1
}

function getMediaKind(msg) {
  if (!msg?.isMedia) return null
  if (msg.message_type === 'image') return 'image'
  if (msg.message_type === 'audio') return 'audio'
  try {
    const parsed = JSON.parse(msg.encrypted_content || '{}')
    if ((parsed.type || '').startsWith('video/')) return 'video'
  } catch {}
  return msg.message_type === 'file' ? 'file' : null
}

function MediaBubble({ msg, token, mySecretKey, partnerKey, isGroup, isMine }) {
  const [decryptedData, setDecryptedData] = useState(msg.localPreviewUrl ? {
    url: msg.localPreviewUrl,
    name: msg.message_type === 'audio' ? 'voice' : 'preview',
    type: msg.message_type === 'audio' ? 'audio/webm' : (msg.message_type === 'image' ? 'image/*' : ''),
    local: true,
  } : null)
  const [loading, setLoading] = useState(false)
  const stopEvent = (e) => {
    e.stopPropagation()
  }
  const stopContext = (e) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDecrypt = async () => {
    if (loading || decryptedData || isGroup || !msg.file_id) return
    setLoading(true)
    try {
      const { iv, wrappedKey, name, type } = JSON.parse(msg.encrypted_content)
      const res = await fetch(`/api/files/${msg.file_id}`, { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) throw new Error('file_load_failed')
      const buffer = await res.arrayBuffer()
      const decrypted = await decryptFile(buffer, iv, wrappedKey, mySecretKey, partnerKey)
      if (decrypted) {
        setDecryptedData({
          url: URL.createObjectURL(new Blob([decrypted], { type: type || 'application/octet-stream' })),
          name: name || 'file',
          type: type || 'application/octet-stream',
          local: false,
        })
      }
    } catch (e) {
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!isGroup && !decryptedData && (msg.message_type === 'image' || msg.message_type === 'audio')) handleDecrypt()
  }, [decryptedData, isGroup, msg.message_type])

  useEffect(() => {
    return () => {
      if (decryptedData?.url && !decryptedData.local) URL.revokeObjectURL(decryptedData.url)
    }
  }, [decryptedData])

  if (isGroup) return <div style={{ fontSize: '0.9rem' }}>📄 Файл группы</div>
  if (msg.uploadStage) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 180, marginTop: 4 }}>
        <div style={{ fontSize: '0.9rem', fontWeight: 500 }}>
          {msg.message_type === 'audio' ? 'Голосовое сообщение' : (msg.message_type === 'image' ? 'Изображение' : 'Файл')}
        </div>
        <div style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.72)' }}>{msg.uploadStage}</div>
        <div style={{ width: '100%', height: 6, borderRadius: 999, background: 'rgba(255,255,255,0.12)', overflow: 'hidden' }}>
          <div style={{ width: `${msg.uploadProgress || 0}%`, height: '100%', background: 'var(--primary)', transition: 'width 0.2s ease' }} />
        </div>
        <div style={{ fontSize: '0.76rem', color: 'rgba(255,255,255,0.72)', textAlign: 'right' }}>{msg.uploadProgress || 0}%</div>
      </div>
    )
  }
  if (!decryptedData) return <div onClick={(e) => { stopEvent(e); handleDecrypt() }} onTouchStart={stopEvent} onContextMenu={stopContext} style={{ cursor: 'pointer', fontStyle: 'italic', fontSize: '0.9rem' }}>{loading ? 'Расшифровка...' : msg.message_type === 'audio' ? '🎤 Голосовое сообщение' : '📄 Файл'}</div>
  if (msg.message_type === 'image') return <img src={decryptedData.url} alt="pic" style={{ maxWidth: '100%', borderRadius: '10px', marginTop: '2px', display: 'block' }} />
  if (msg.message_type === 'audio') return <AudioMessagePlayer src={decryptedData.url} isMine={isMine} />
  if ((decryptedData.type || '').startsWith('video/')) {
    return (
      <video
        src={decryptedData.url}
        controls
        playsInline
        style={{ maxWidth: '100%', borderRadius: '10px', marginTop: '5px', background: '#000' }}
      />
    )
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }} onClick={stopEvent} onTouchStart={stopEvent} onContextMenu={stopContext}>
      <div style={{ fontSize: '0.92rem', fontWeight: 500 }}>{decryptedData.name}</div>
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        <a href={decryptedData.url} target="_blank" rel="noreferrer" onClick={stopEvent} onTouchStart={stopEvent} onContextMenu={stopContext} style={{ color: 'var(--primary)', textDecoration: 'none' }}>Открыть</a>
        <a href={decryptedData.url} download={decryptedData.name} onClick={stopEvent} onTouchStart={stopEvent} onContextMenu={stopContext} style={{ color: 'var(--primary)', textDecoration: 'none' }}>Скачать</a>
      </div>
    </div>
  )
}

function AudioMessagePlayer({ src, isMine }) {
  const audioRef = useRef(null)
  const [playing, setPlaying] = useState(false)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return undefined

    const onLoaded = () => setDuration(Number.isFinite(audio.duration) ? audio.duration : 0)
    const onTime = () => setCurrentTime(audio.currentTime || 0)
    const onEnded = () => {
      setPlaying(false)
      setCurrentTime(0)
    }

    audio.addEventListener('loadedmetadata', onLoaded)
    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('ended', onEnded)
    return () => {
      audio.pause()
      audio.removeEventListener('loadedmetadata', onLoaded)
      audio.removeEventListener('timeupdate', onTime)
      audio.removeEventListener('ended', onEnded)
    }
  }, [src])

  const togglePlayback = async (e) => {
    e?.stopPropagation?.()
    const audio = audioRef.current
    if (!audio) return
    if (playing) {
      audio.pause()
      setPlaying(false)
      return
    }
    try {
      await audio.play()
      setPlaying(true)
    } catch {}
  }

  const progress = duration > 0 ? Math.min((currentTime / duration) * 100, 100) : 0
  const bars = [10, 16, 12, 20, 14, 18, 12, 16, 11, 19, 13, 17, 12, 15]
  const formatDuration = (value) => {
    const safe = Math.max(0, Math.floor(value || 0))
    const m = Math.floor(safe / 60)
    const s = `${safe % 60}`.padStart(2, '0')
    return `${m}:${s}`
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: '220px', marginTop: '4px' }}>
      <audio ref={audioRef} src={src} preload="metadata" />
      <button
        type="button"
        onClick={togglePlayback}
        onTouchStart={(e) => e.stopPropagation()}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation() }}
        style={{
          width: 38,
          height: 38,
          borderRadius: '50%',
          border: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          background: isMine ? 'rgba(255,255,255,0.18)' : 'rgba(96,165,250,0.18)',
          color: '#fff',
          flexShrink: 0,
        }}
      >
        {playing ? <Pause size={18} /> : <Play size={18} style={{ marginLeft: 2 }} />}
      </button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ position: 'relative', height: 24, display: 'flex', alignItems: 'center', gap: 3 }}>
          {bars.map((height, index) => (
            <span
              key={index}
              style={{
                width: 4,
                height,
                borderRadius: 999,
                background: progress >= ((index + 1) / bars.length) * 100 ? '#7dd3fc' : 'rgba(255,255,255,0.35)',
                transition: 'background 0.15s ease',
              }}
            />
          ))}
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: '50%',
              height: 2,
              transform: 'translateY(-50%)',
              background: 'rgba(255,255,255,0.12)',
              zIndex: -1,
            }}
          />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'rgba(255,255,255,0.72)' }}>
          <span>Голосовое</span>
          <span>{formatDuration(playing ? currentTime : (currentTime || duration))}</span>
        </div>
      </div>
    </div>
  )
}

function ReactionBar({ msg, onToggle }) {
  const reactions = Array.isArray(msg.reactions) ? msg.reactions : []

  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
      {reactions.map(item => (
        <button
          key={`${msg.id}_${item.emoji}`}
          type="button"
          onClick={() => onToggle?.(item.emoji)}
          style={{
            border: 'none',
            background: item.mine ? 'rgba(56,189,248,0.18)' : 'rgba(255,255,255,0.08)',
            color: '#fff',
            borderRadius: 999,
            padding: '3px 8px',
            fontSize: '0.78rem',
            cursor: 'pointer',
          }}
        >
          {item.emoji} {item.count}
        </button>
      ))}
    </div>
  )
}
