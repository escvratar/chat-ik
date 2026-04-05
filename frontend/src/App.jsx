import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import Login from './components/Login'
import ServerSetup from './components/ServerSetup'
import ChatList from './components/ChatList'
import ChatWindow from './components/ChatWindow'
import CallModal from './components/CallModal'
import AdminPanel from './components/AdminPanel'
import CreateGroupModal from './components/CreateGroupModal'
import SettingsPanel from './components/SettingsPanel'
import useKeyRotation from './hooks/useKeyRotation'
import { playMessageTone } from './utils/sounds.js'
import { QRCodeSVG } from 'qrcode.react'
import { QrCode, LogOut, ShieldAlert, Bell, SlidersHorizontal, MessageSquare, Phone, Users, Settings } from 'lucide-react'
import { getServerBaseUrl, setServerBaseUrl, getServerLocationInfo, createWsCandidates } from './utils/serverConfig.js'

const defaultSettings = {
  presetId: 'pulse',
  accentTheme: 'mint',
  compactMode: false,
  bubbleStyle: 'rounded',
  animations: true,
  animatedBackdrop: true,
  notifyMessages: true,
  notifyCalls: true,
  pushTone: 'soft',
  messageIncomingTone: 'soft',
  messageOutgoingTone: 'soft',
  callRingtone: 'classic',
  richNotifications: true,
  wallpaperIntensity: 64,
  wallpaperImage: null,
  fontScale: 1,
  glassBlur: 26,
  messageGap: 12,
  bubbleOpacity: 0.96,
  panelRadius: 26,
  listStyle: 'cards',
  sidebarStyle: 'glass',
  avatarShape: 'squircle',
  accentGlow: true,
}

const pulseStyleSettings = {
  presetId: 'pulse',
  accentTheme: 'mint',
  compactMode: false,
  bubbleStyle: 'rounded',
  animations: true,
  animatedBackdrop: true,
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
}

const uiSettingsVersion = 3

const migrateUiSettings = (saved = {}) => ({
  ...defaultSettings,
  ...pulseStyleSettings,
  notifyMessages: typeof saved.notifyMessages === 'boolean' ? saved.notifyMessages : defaultSettings.notifyMessages,
  notifyCalls: typeof saved.notifyCalls === 'boolean' ? saved.notifyCalls : defaultSettings.notifyCalls,
  pushTone: saved.pushTone || defaultSettings.pushTone,
  messageIncomingTone: saved.messageIncomingTone || saved.pushTone || defaultSettings.messageIncomingTone,
  messageOutgoingTone: saved.messageOutgoingTone || saved.pushTone || defaultSettings.messageOutgoingTone,
  callRingtone: saved.callRingtone || defaultSettings.callRingtone,
  richNotifications: typeof saved.richNotifications === 'boolean' ? saved.richNotifications : defaultSettings.richNotifications,
})

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4)
  const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i)
  return outputArray
}

function App() {
  const [serverUrl, setServerUrl] = useState(() => getServerBaseUrl())
  const [showServerSetup, setShowServerSetup] = useState(() => !getServerBaseUrl())
  const [token, setToken] = useState(localStorage.getItem('token'))
  const [user, setUser] = useState(JSON.parse(localStorage.getItem('user')))
  const [selectedChat, setSelectedChat] = useState(null)
  const [showAdminPanel, setShowAdminPanel] = useState(false)
  const [showCreateGroup, setShowCreateGroup] = useState(false)
  const [showQRModal, setShowQRModal] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [pushSupported, setPushSupported] = useState(false)
  const [uiSettings, setUiSettings] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('chatik_ui_settings') || '{}')
      const savedVersion = Number(localStorage.getItem('chatik_ui_settings_version') || '0')
      if (savedVersion < uiSettingsVersion) {
        return migrateUiSettings(saved)
      }
      return { ...defaultSettings, ...saved }
    } catch {
      return defaultSettings
    }
  })
  const [liveMessages, setLiveMessages] = useState({})
  const [presenceMap, setPresenceMap] = useState({})
  const [wsConnected, setWsConnected] = useState(false)
  const [chatListRefreshNonce, setChatListRefreshNonce] = useState(0)
  const wsRef = useRef(null)
  const reconnectTimerRef = useRef(null)
  const intentionalCloseRef = useRef(false)
  const wsFailureCountRef = useRef(0)
  const callSignalSinceRef = useRef(new Date(0).toISOString())
  const processedSignalIdsRef = useRef(new Set())
  const currentCallIdRef = useRef(null)
  const ignoredCallIdsRef = useRef(new Set())
  const pendingIceCandidatesRef = useRef([])

  const [callState, setCallState] = useState(null)
  const [callPartner, setCallPartner] = useState(null)
  const [localStream, setLocalStream] = useState(null)
  const [remoteStream, setRemoteStream] = useState(null)
  const [remoteAudioStream, setRemoteAudioStream] = useState(null)
  const [remoteVideoStream, setRemoteVideoStream] = useState(null)
  const [callDebug, setCallDebug] = useState({
    connectionState: 'new',
    iceConnectionState: 'new',
    iceGatheringState: 'new',
    signalingState: 'stable',
    queuedIce: 0,
    remoteAudioTracks: 0,
    remoteVideoTracks: 0,
    remoteAudioMuted: [],
    remoteVideoMuted: [],
    remoteAudioReady: [],
    remoteVideoReady: [],
    inboundAudioBytes: 0,
    inboundVideoBytes: 0,
    framesDecoded: 0,
    packetsLost: 0,
    selectedPair: 'n/a',
  })
  const [isAudioMuted, setIsAudioMuted] = useState(false)
  const [isVideoMuted, setIsVideoMuted] = useState(false)
  const peerConnection = useRef(null)
  const remoteMediaStreamRef = useRef(null)
  const remoteAudioStreamRef = useRef(null)
  const remoteVideoStreamRef = useRef(null)
  const incomingCallVideoRef = useRef(true)
  const incomingOfferRef = useRef(null)
  const notifiedMessageIdsRef = useRef(new Set())
  const serverInfo = useMemo(() => getServerLocationInfo(), [serverUrl])
  const shouldUseWebSocket = useMemo(() => Boolean(serverInfo?.host), [serverInfo])

  const getRealtimeBaseHost = useCallback(() => {
    return serverInfo?.host || 'localhost'
  }, [serverInfo])

  const applyServerUrl = useCallback((nextUrl) => {
    const normalized = setServerBaseUrl(nextUrl)
    if (!normalized) return
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    setToken(null)
    setUser(null)
    setSelectedChat(null)
    setServerUrl(normalized)
    setShowServerSetup(false)
  }, [])

  useKeyRotation(token, user)

  useEffect(() => {
    localStorage.setItem('chatik_ui_settings', JSON.stringify(uiSettings))
    localStorage.setItem('chatik_ui_settings_version', String(uiSettingsVersion))
    const root = document.documentElement
    root.dataset.theme = uiSettings.accentTheme
    root.dataset.compact = uiSettings.compactMode ? 'true' : 'false'
    root.dataset.bubbles = uiSettings.bubbleStyle
    root.dataset.motion = uiSettings.animations ? 'full' : 'reduced'
    root.dataset.backdrop = uiSettings.animatedBackdrop ? 'animated' : 'static'
    root.dataset.list = uiSettings.listStyle
    root.dataset.sidebar = uiSettings.sidebarStyle
    root.dataset.avatars = uiSettings.avatarShape
    root.dataset.glow = uiSettings.accentGlow ? 'on' : 'off'
    root.dataset.preset = uiSettings.presetId || 'default'
    root.style.setProperty('--wallpaper-strength', `${uiSettings.wallpaperIntensity / 100}`)
    root.style.setProperty('--wallpaper-image', uiSettings.wallpaperImage ? `url("${uiSettings.wallpaperImage}")` : 'none')
    root.style.setProperty('--font-scale', `${uiSettings.fontScale}`)
    root.style.setProperty('--glass-blur', `${uiSettings.glassBlur}px`)
    root.style.setProperty('--message-gap', `${uiSettings.messageGap}px`)
    root.style.setProperty('--bubble-opacity', `${uiSettings.bubbleOpacity}`)
    root.style.setProperty('--panel-radius', `${uiSettings.panelRadius}px`)
  }, [uiSettings])

  const handleAvatarUploaded = useCallback((payload) => {
    if (!payload || !user) return
    if (!('avatar_object_key' in payload) && !('avatar_url' in payload)) return
    setUser(prev => {
      if (!prev) return prev
      const next = { ...prev, ...payload }
      localStorage.setItem('user', JSON.stringify(next))
      return next
    })
  }, [user])

  const qrPayload = useMemo(() => JSON.stringify({
    t: token,
    u: user ? {
      id: user.id,
      username: user.username,
      display_name: user.display_name,
      avatar_color: user.avatar_color,
      is_admin: user.is_admin,
    } : null,
    k: user ? localStorage.getItem(`chatik_sk_${user.id}`) : null,
  }), [token, user])

  const updateCallDebug = useCallback((patch) => {
    setCallDebug(prev => ({ ...prev, ...patch }))
  }, [])

  useEffect(() => {
    if (!serverUrl) return
    if ('serviceWorker' in navigator && 'PushManager' in window) {
      setPushSupported(true)
      registerSW()
    }
  }, [serverUrl])

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    navigator.serviceWorker.ready.then((reg) => {
      reg.active?.postMessage({
        type: user?.id ? 'set-user' : 'clear-user',
        userId: user?.id || null,
      })
    }).catch(() => {})
  }, [user?.id])

  useEffect(() => {
    if (!token) return
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return
    if (Notification.permission === 'granted') {
      navigator.serviceWorker.ready.then(reg => subscribeToPush(reg)).catch(() => {})
    }
  }, [token])

  const registerSW = async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js')
      if (token) subscribeToPush(registration)
    } catch (e) {}
  }

  const subscribeToPush = async (registration) => {
    try {
      const publicVapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY
      if (!publicVapidKey) return
      const existing = await registration.pushManager.getSubscription()
      const subscription = existing || await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicVapidKey)
      })
      await fetch('/api/users/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ subscription })
      })
    } catch (e) {}
  }

  const requestNotificationPermission = () => {
    if (!('Notification' in window)) {
      alert('Ваш браузер не поддерживает уведомления.')
      return
    }
    if (serverInfo && !serverInfo.secure && serverInfo.hostname !== 'localhost' && serverInfo.hostname !== '127.0.0.1') {
      alert('Для push-уведомлений нужен HTTPS.')
      return
    }
    if (Notification.permission === 'denied') {
      alert('Уведомления отключены в настройках браузера. Разрешите их для этого сайта.')
      return
    }
    Notification.requestPermission().then(permission => {
      if (permission === 'granted') registerSW()
    })
  }

  const showBrowserNotification = useCallback((title, options = {}) => {
    if (!('Notification' in window) || Notification.permission !== 'granted') return
    navigator.serviceWorker?.ready?.then((registration) => {
      if (registration?.showNotification) {
        registration.showNotification(title, {
          body: options.body || '',
          tag: options.tag,
          silent: options.silent ?? false,
          data: { url: '/' },
        }).catch(() => {})
      } else {
        try {
          const notification = new Notification(title, {
            body: options.body || '',
            tag: options.tag,
            silent: options.silent ?? false,
          })
          notification.onclick = () => {
            window.focus()
            notification.close()
          }
        } catch {}
      }
    }).catch(() => {})
  }, [])

  const playOutgoingMessageSound = useCallback(() => {
    playMessageTone('outgoing', uiSettings.messageOutgoingTone || uiSettings.pushTone)
  }, [uiSettings.messageOutgoingTone, uiSettings.pushTone])

  const playIncomingMessageSound = useCallback(() => {
    if (!uiSettings.notifyMessages) return
    playMessageTone('incoming', uiSettings.messageIncomingTone || uiSettings.pushTone)
  }, [uiSettings.messageIncomingTone, uiSettings.notifyMessages, uiSettings.pushTone])

  const handleLogin = (t, u) => {
    localStorage.setItem('token', t)
    localStorage.setItem('user', JSON.stringify(u))
    setToken(t)
    setUser(u)
  }

  const handleLogout = () => {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    setToken(null)
    setUser(null)
    setSelectedChat(null)
    setPresenceMap({})
    setLiveMessages({})
    currentCallIdRef.current = null
    ignoredCallIdsRef.current = new Set()
    processedSignalIdsRef.current = new Set()
    intentionalCloseRef.current = true
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
    if (wsRef.current) wsRef.current.close()
  }

  const endCallCleanUp = useCallback(() => {
    if (currentCallIdRef.current) ignoredCallIdsRef.current.add(currentCallIdRef.current)
    setLocalStream(prev => {
      prev?.getTracks?.().forEach(t => t.stop())
      return null
    })
    setRemoteStream(prev => {
      prev?.getTracks?.().forEach(track => track.stop())
      return null
    })
    setRemoteAudioStream(prev => {
      prev?.getTracks?.().forEach(track => track.stop())
      return null
    })
    setRemoteVideoStream(prev => {
      prev?.getTracks?.().forEach(track => track.stop())
      return null
    })
    setCallState(null)
    setCallPartner(null)
    setCallDebug({
      connectionState: 'new',
      iceConnectionState: 'new',
      iceGatheringState: 'new',
      signalingState: 'stable',
      queuedIce: 0,
      remoteAudioTracks: 0,
      remoteVideoTracks: 0,
      remoteAudioMuted: [],
      remoteVideoMuted: [],
      remoteAudioReady: [],
      remoteVideoReady: [],
      inboundAudioBytes: 0,
      inboundVideoBytes: 0,
      framesDecoded: 0,
      packetsLost: 0,
      selectedPair: 'n/a',
    })
    setIsAudioMuted(false)
    setIsVideoMuted(false)
    incomingCallVideoRef.current = true
    incomingOfferRef.current = null
    currentCallIdRef.current = null
    pendingIceCandidatesRef.current = []
    remoteMediaStreamRef.current = null
    remoteAudioStreamRef.current = null
    remoteVideoStreamRef.current = null
    if (peerConnection.current) {
      peerConnection.current.ontrack = null
      peerConnection.current.onicecandidate = null
      peerConnection.current.close()
      peerConnection.current = null
    }
  }, [])

  const sendWsMessage = useCallback((payload) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== 1) return false
    try {
      ws.send(JSON.stringify(payload))
      return true
    } catch {
      return false
    }
  }, [])

  const sendCallSignal = useCallback(async (type, targetId, payload = {}) => {
    if (!targetId) return false
    if (sendWsMessage({ type, target_id: targetId, ...payload })) return true

    try {
      const res = await fetch('/api/users/call-signal', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          target_id: targetId,
          type,
          payload,
        }),
      })
      return res.ok
    } catch {
      return false
    }
  }, [sendWsMessage, token])

  const createPeerConnection = useCallback((partnerId) => {
    const host = getRealtimeBaseHost()
    const turnUsername = import.meta.env.VITE_TURN_USERNAME || ''
    const turnPassword = import.meta.env.VITE_TURN_PASSWORD || ''
    remoteMediaStreamRef.current = new MediaStream()
    remoteAudioStreamRef.current = new MediaStream()
    remoteVideoStreamRef.current = new MediaStream()
    setRemoteStream(remoteMediaStreamRef.current)
    setRemoteAudioStream(remoteAudioStreamRef.current)
    setRemoteVideoStream(remoteVideoStreamRef.current)
    const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }]
    if (turnUsername && turnPassword) {
      iceServers.push({
        urls: [
          `stun:${host}:3478`,
          `stun:${host}:3479`,
          `turn:${host}:3478?transport=udp`,
          `turn:${host}:3478?transport=tcp`,
          `turn:${host}:3479?transport=udp`,
          `turn:${host}:3479?transport=tcp`,
        ],
        username: turnUsername,
        credential: turnPassword,
      })
    }
    const pc = new RTCPeerConnection({
      iceServers,
      iceTransportPolicy: 'all',
      bundlePolicy: 'max-bundle',
      iceCandidatePoolSize: 4,
    })
    pc.onicecandidate = (e) => {
      if (e.candidate && currentCallIdRef.current) {
        sendCallSignal('call:ice', partnerId, { candidate: e.candidate, call_id: currentCallIdRef.current })
      }
    }
    pc.ontrack = (e) => {
      const track = e.track
      if (!track) return

      const syncAggregate = () => {
        const next = new MediaStream()
        remoteAudioStreamRef.current?.getAudioTracks?.().forEach(item => next.addTrack(item))
        remoteVideoStreamRef.current?.getVideoTracks?.().forEach(item => next.addTrack(item))
        remoteMediaStreamRef.current = next
        setRemoteStream(new MediaStream(next.getTracks()))
        updateCallDebug({
          queuedIce: pendingIceCandidatesRef.current.length,
          remoteAudioTracks: remoteAudioStreamRef.current?.getAudioTracks?.().length || 0,
          remoteVideoTracks: remoteVideoStreamRef.current?.getVideoTracks?.().length || 0,
          remoteAudioMuted: remoteAudioStreamRef.current?.getAudioTracks?.().map(track => !!track.muted) || [],
          remoteVideoMuted: remoteVideoStreamRef.current?.getVideoTracks?.().map(track => !!track.muted) || [],
          remoteAudioReady: remoteAudioStreamRef.current?.getAudioTracks?.().map(track => track.readyState) || [],
          remoteVideoReady: remoteVideoStreamRef.current?.getVideoTracks?.().map(track => track.readyState) || [],
        })
      }

      const applyTrack = () => {
        const isolated = new MediaStream([track])
        if (track.kind === 'audio') {
          remoteAudioStreamRef.current = isolated
          setRemoteAudioStream(new MediaStream(isolated.getTracks()))
        }
        if (track.kind === 'video') {
          remoteVideoStreamRef.current = isolated
          setRemoteVideoStream(new MediaStream(isolated.getTracks()))
        }
        syncAggregate()
      }

      track.onunmute = applyTrack
      track.onmute = syncAggregate
      track.onended = syncAggregate
      applyTrack()
    }
    pc.onconnectionstatechange = () => {
      updateCallDebug({
        connectionState: pc.connectionState,
        iceConnectionState: pc.iceConnectionState,
        iceGatheringState: pc.iceGatheringState,
        signalingState: pc.signalingState,
      })
      if (pc.connectionState === 'connected') {
        pendingIceCandidatesRef.current = []
        updateCallDebug({ queuedIce: 0 })
      }
    }
    pc.oniceconnectionstatechange = () => {
      updateCallDebug({
        connectionState: pc.connectionState,
        iceConnectionState: pc.iceConnectionState,
        iceGatheringState: pc.iceGatheringState,
        signalingState: pc.signalingState,
      })
      if (['failed', 'closed'].includes(pc.iceConnectionState)) {
        endCallCleanUp()
      }
    }
    pc.onsignalingstatechange = () => {
      updateCallDebug({ signalingState: pc.signalingState })
    }
    pc.onicegatheringstatechange = () => {
      updateCallDebug({ iceGatheringState: pc.iceGatheringState })
    }
    return pc
  }, [endCallCleanUp, getRealtimeBaseHost, sendCallSignal, updateCallDebug])

  const getCallMediaConstraints = useCallback((withVideo) => ({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    video: withVideo ? {
      width: { ideal: 1920, max: 1920 },
      height: { ideal: 1080, max: 1080 },
      frameRate: { ideal: 30, max: 30 },
      facingMode: 'user',
    } : false,
  }), [])

  const tuneOutgoingVideo = useCallback((pc) => {
    const sender = pc?.getSenders?.().find(item => item.track?.kind === 'video')
    if (!sender?.getParameters || !sender?.setParameters) return
    const params = sender.getParameters() || {}
    params.encodings = [{ ...(params.encodings?.[0] || {}), maxBitrate: 3200000, maxFramerate: 30 }]
    sender.setParameters(params).catch(() => {})
  }, [])

  const flushPendingIceCandidates = useCallback(async () => {
    if (!peerConnection.current || !peerConnection.current.remoteDescription) return
    const queue = [...pendingIceCandidatesRef.current]
    pendingIceCandidatesRef.current = []
    for (const candidate of queue) {
      try {
        await peerConnection.current.addIceCandidate(new RTCIceCandidate(candidate))
      } catch {}
    }
  }, [])

  const handleRealtimeMessage = useCallback(async (msg) => {
    if (msg.id) {
      if (processedSignalIdsRef.current.has(msg.id)) return
      processedSignalIdsRef.current.add(msg.id)
    }
    if (msg.type === 'presence') {
      setPresenceMap(prev => ({ ...prev, [msg.user_id]: msg.online }))
      setSelectedChat(prev => {
        if (!prev || prev.is_group) return prev
        const partnerId = prev.partner?.id || prev.partner_id
        if (partnerId !== msg.user_id) return prev
        return {
          ...prev,
          partner_online: msg.online,
          partner: prev.partner ? { ...prev.partner, online: msg.online } : prev.partner,
        }
      })
      return
    }
    if (['message', 'read', 'typing'].includes(msg.type)) {
        if (msg.type === 'message' && msg.sender_id !== user?.id && !notifiedMessageIdsRef.current.has(msg.id)) {
          notifiedMessageIdsRef.current.add(msg.id)
          if (uiSettings.notifyMessages && (document.hidden || selectedChat?.id !== msg.chat_id)) {
            playMessageTone('incoming', uiSettings.messageIncomingTone || uiSettings.pushTone)
          }
          if (uiSettings.notifyMessages && (document.hidden || selectedChat?.id !== msg.chat_id)) {
            showBrowserNotification(msg.sender_name || 'Новое сообщение', {
              body: uiSettings.richNotifications
                ? (msg.message_type === 'text' ? 'У вас новое сообщение' : 'Новое вложение')
                : 'Новое событие в чате',
              tag: `chat-message-${msg.id}`,
              silent: false,
            })
          }
        }
      setLiveMessages(prev => ({ ...prev, [msg.chat_id || 'global']: [...(prev[msg.chat_id || 'global'] || []), msg] }))
      if (msg.type === 'message' && msg.sender_id !== user?.id) {
        setChatListRefreshNonce(prev => prev + 1)
      }
      return
    }
    if (msg.call_id && ignoredCallIdsRef.current.has(msg.call_id)) return
    if (msg.type === 'call:offer') {
      currentCallIdRef.current = msg.call_id || msg.id || crypto.randomUUID()
      pendingIceCandidatesRef.current = []
      incomingCallVideoRef.current = !!msg.video
      incomingOfferRef.current = msg.offer || null
      setCallPartner({ id: msg.from_id, display_name: msg.from_name || 'Вызов' })
      setCallState('incoming')
      if (uiSettings.notifyCalls) {
        playMessageTone('incoming', uiSettings.messageIncomingTone || uiSettings.pushTone)
        showBrowserNotification('Входящий звонок', {
          body: `${msg.from_name || 'Пользователь'} звонит вам`,
          tag: `incoming-call-${msg.call_id || msg.id || msg.from_id}`,
          silent: false,
        })
      }
      return
    }
    if (msg.type === 'call:answer') {
      if (msg.call_id && currentCallIdRef.current && msg.call_id !== currentCallIdRef.current) return
      if (peerConnection.current) {
        await peerConnection.current.setRemoteDescription(new RTCSessionDescription(msg.answer))
        await flushPendingIceCandidates()
      }
      setCallState('active')
      return
    }
    if (msg.type === 'call:ice' && msg.candidate) {
      if (msg.call_id && currentCallIdRef.current && msg.call_id !== currentCallIdRef.current) return
      if (!peerConnection.current || !peerConnection.current.remoteDescription) {
        pendingIceCandidatesRef.current.push(msg.candidate)
        updateCallDebug({ queuedIce: pendingIceCandidatesRef.current.length })
        return
      }
      await peerConnection.current.addIceCandidate(new RTCIceCandidate(msg.candidate))
      return
    }
    if (['call:reject', 'call:end'].includes(msg.type)) {
      if (msg.call_id && currentCallIdRef.current && msg.call_id !== currentCallIdRef.current) return
      endCallCleanUp()
    }
  }, [createPeerConnection, endCallCleanUp, flushPendingIceCandidates, selectedChat?.id, showBrowserNotification, uiSettings.richNotifications, uiSettings.notifyMessages, uiSettings.notifyCalls, uiSettings.pushTone, uiSettings.messageIncomingTone, updateCallDebug, user?.id])

  useEffect(() => {
    if (!token) return undefined
    intentionalCloseRef.current = false
    wsFailureCountRef.current = 0
    callSignalSinceRef.current = new Date().toISOString()
    processedSignalIdsRef.current = new Set()
    ignoredCallIdsRef.current = new Set()
    currentCallIdRef.current = null

    const connect = () => {
      if (!shouldUseWebSocket) return
      if (wsFailureCountRef.current >= 2) return
      const candidates = createWsCandidates()
      if (!candidates.length) return
      let candidateIndex = 0

      const openCandidate = () => {
        const wsUrl = candidates[candidateIndex]
        const ws = new WebSocket(wsUrl)
        wsRef.current = ws

        ws.onopen = () => {
          wsFailureCountRef.current = 0
          setWsConnected(true)
          ws.send(JSON.stringify({ type: 'auth', token }))
        }

        ws.onmessage = async (evt) => {
          try {
            const msg = JSON.parse(evt.data)
            await handleRealtimeMessage(msg)
          } catch (e) {}
        }

        ws.onclose = () => {
          setWsConnected(false)
          if (!intentionalCloseRef.current && candidateIndex < candidates.length - 1) {
            candidateIndex += 1
            openCandidate()
            return
          }
          if (!intentionalCloseRef.current) {
            wsFailureCountRef.current += 1
            reconnectTimerRef.current = setTimeout(connect, 30000)
          }
        }

        ws.onerror = () => {
          setWsConnected(false)
          try { ws.close() } catch {}
        }
      }

      openCandidate()
    }

    connect()
    return () => {
      intentionalCloseRef.current = true
      setWsConnected(false)
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
      if (wsRef.current) wsRef.current.close()
    }
  }, [token, handleRealtimeMessage, shouldUseWebSocket])

  useEffect(() => {
    if (!token) return undefined

    const heartbeat = async () => {
      try {
        await fetch('/api/users/me/heartbeat', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        })
      } catch {}
    }

    heartbeat()
    const timer = setInterval(heartbeat, 25000)
    return () => clearInterval(timer)
  }, [token])

  useEffect(() => {
    if (!token) return undefined

    const syncPresence = async () => {
      try {
          const res = await fetch('/api/users/presence', {
            headers: { Authorization: `Bearer ${token}` },
            cache: 'no-store',
          })
        if (!res.ok) return
        const data = await res.json()
        const next = Object.fromEntries(data.map(item => [item.id, item.online]))
        setPresenceMap(next)
      } catch {}
    }

    syncPresence()
    const timer = setInterval(syncPresence, 5000)
    return () => clearInterval(timer)
  }, [token])

  useEffect(() => {
    setSelectedChat(prev => {
      if (!prev || prev.is_group) return prev
      const partnerId = prev.partner?.id || prev.partner_id
      if (!partnerId || typeof presenceMap[partnerId] === 'undefined') return prev
      return {
        ...prev,
        partner_online: presenceMap[partnerId],
        partner: prev.partner ? { ...prev.partner, online: presenceMap[partnerId] } : prev.partner,
      }
    })
  }, [presenceMap])

  useEffect(() => {
    if (!token || wsConnected || shouldUseWebSocket) return undefined

    const pollSignals = async () => {
      try {
        const res = await fetch(`/api/users/me/call-signals?since=${encodeURIComponent(callSignalSinceRef.current)}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) return
        const signals = await res.json()
        for (const signal of signals) {
          callSignalSinceRef.current = signal.created_at
          await handleRealtimeMessage({
            id: signal.id,
            type: signal.signal_type,
            from_id: signal.from_id,
            from_name: signal.from_name,
            ...(signal.payload || {}),
          })
        }
      } catch {}
    }

    pollSignals()
    const timer = setInterval(pollSignals, 1200)
    return () => clearInterval(timer)
  }, [handleRealtimeMessage, token, wsConnected, shouldUseWebSocket])

  useEffect(() => {
    if (!callState || !peerConnection.current) return undefined
    const timer = setInterval(async () => {
      const pc = peerConnection.current
      if (!pc) return
      try {
        const stats = await pc.getStats()
        let inboundAudioBytes = 0
        let inboundVideoBytes = 0
        let framesDecoded = 0
        let packetsLost = 0
        let selectedPair = 'n/a'
        const byId = new Map()
        stats.forEach(report => byId.set(report.id, report))
        stats.forEach(report => {
          if (report.type === 'inbound-rtp' && !report.isRemote) {
            if (report.kind === 'audio') inboundAudioBytes += report.bytesReceived || 0
            if (report.kind === 'video') {
              inboundVideoBytes += report.bytesReceived || 0
              framesDecoded += report.framesDecoded || 0
            }
            packetsLost += report.packetsLost || 0
          }
          if ((report.type === 'transport' && report.selectedCandidatePairId) || (report.type === 'candidate-pair' && report.state === 'succeeded' && report.nominated)) {
            const pair = report.type === 'transport' ? byId.get(report.selectedCandidatePairId) : report
            if (pair) {
              const local = byId.get(pair.localCandidateId)
              const remote = byId.get(pair.remoteCandidateId)
              selectedPair = `${local?.candidateType || 'local'} -> ${remote?.candidateType || 'remote'}`
            }
          }
        })
        updateCallDebug({
          connectionState: pc.connectionState,
          iceConnectionState: pc.iceConnectionState,
          iceGatheringState: pc.iceGatheringState,
          signalingState: pc.signalingState,
          queuedIce: pendingIceCandidatesRef.current.length,
          inboundAudioBytes,
          inboundVideoBytes,
          framesDecoded,
          packetsLost,
          selectedPair,
          remoteAudioTracks: remoteAudioStreamRef.current?.getAudioTracks?.().length || 0,
          remoteVideoTracks: remoteVideoStreamRef.current?.getVideoTracks?.().length || 0,
          remoteAudioMuted: remoteAudioStreamRef.current?.getAudioTracks?.().map(track => !!track.muted) || [],
          remoteVideoMuted: remoteVideoStreamRef.current?.getVideoTracks?.().map(track => !!track.muted) || [],
          remoteAudioReady: remoteAudioStreamRef.current?.getAudioTracks?.().map(track => track.readyState) || [],
          remoteVideoReady: remoteVideoStreamRef.current?.getVideoTracks?.().map(track => track.readyState) || [],
        })
      } catch {}
    }, 1000)
    return () => clearInterval(timer)
  }, [callState, updateCallDebug])

  const initiateCall = async (partner, video = true) => {
    if (!partner?.id) return
    try {
      const callId = crypto.randomUUID()
      currentCallIdRef.current = callId
      setCallPartner(partner)
      setCallState('outgoing')
      peerConnection.current = createPeerConnection(partner.id)
      const stream = await navigator.mediaDevices.getUserMedia(getCallMediaConstraints(video))
      setLocalStream(stream)
      setIsAudioMuted(false)
      setIsVideoMuted(!video)
      stream.getTracks().forEach(track => peerConnection.current?.addTrack(track, stream))
      tuneOutgoingVideo(peerConnection.current)
      const offer = await peerConnection.current.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true })
      await peerConnection.current.setLocalDescription(offer)
      if (!await sendCallSignal('call:offer', partner.id, { from_name: user?.display_name, offer, video, call_id: callId })) {
        endCallCleanUp()
      }
    } catch {
      endCallCleanUp()
    }
  }

  const acceptCall = async () => {
    try {
      const wantsVideo = incomingCallVideoRef.current
      if (!callPartner?.id || !incomingOfferRef.current) throw new Error('missing_offer')
      peerConnection.current?.close?.()
      peerConnection.current = createPeerConnection(callPartner.id)
      const stream = await navigator.mediaDevices.getUserMedia(getCallMediaConstraints(wantsVideo))
      setLocalStream(stream)
      setIsAudioMuted(false)
      setIsVideoMuted(!wantsVideo)
      stream.getTracks().forEach(track => peerConnection.current?.addTrack(track, stream))
      tuneOutgoingVideo(peerConnection.current)
      await peerConnection.current.setRemoteDescription(new RTCSessionDescription(incomingOfferRef.current))
      await flushPendingIceCandidates()
      const answer = await peerConnection.current.createAnswer()
      await peerConnection.current.setLocalDescription(answer)
      if (!await sendCallSignal('call:answer', callPartner.id, { answer, call_id: currentCallIdRef.current })) return
      setCallState('active')
    } catch {
      endCallCleanUp()
    }
  }

  const toggleAudio = () => {
    if (!localStream) return
    const nextMuted = !isAudioMuted
    localStream.getAudioTracks().forEach(track => {
      track.enabled = !nextMuted
    })
    setIsAudioMuted(nextMuted)
  }

  const toggleVideo = () => {
    if (!localStream) return
    const nextMuted = !isVideoMuted
    localStream.getVideoTracks().forEach(track => {
      track.enabled = !nextMuted
    })
    setIsVideoMuted(nextMuted)
  }

  if (showServerSetup || !serverUrl) {
    return <ServerSetup initialValue={serverUrl} onSave={applyServerUrl} />
  }

  if (!token) return <Login onLogin={handleLogin} serverUrl={serverUrl} onOpenServerSettings={() => setShowServerSetup(true)} />

  return (
    <>
      <div className={`app-container ${selectedChat ? 'chat-open' : ''}`}>
        <div className="app-backdrop">
          <div className="backdrop-orb orb-one" />
          <div className="backdrop-orb orb-two" />
          <div className="backdrop-grid" />
        </div>
        <div className="sidebar">
          <div className="sidebar-header">
            <div>
              <h2 className="sidebar-title">chat-iK</h2>
              <div className="sidebar-subtitle">Сообщения</div>
            </div>
            <div className="sidebar-actions">
              {pushSupported && Notification.permission !== 'granted' && (
                <button title="Уведомления" onClick={requestNotificationPermission} className="icon-btn accent-soft">
                  <Bell size={18} />
                </button>
              )}
              {user?.is_admin && (
                <button title="Админ-панель" onClick={() => setShowAdminPanel(true)} className="icon-btn accent-soft"><ShieldAlert size={18} /></button>
              )}
              <button title="Настройки интерфейса" onClick={() => setShowSettings(true)} className="icon-btn subtle-btn"><SlidersHorizontal size={18} /></button>
              <button title="Вход на другом устройстве" onClick={() => setShowQRModal(true)} className="icon-btn subtle-btn"><QrCode size={18} /></button>
              <button onClick={handleLogout} className="icon-btn danger-soft" title="Выйти"><LogOut size={18} /></button>
            </div>
          </div>
          <ChatList
            token={token}
            user={user}
            refreshNonce={chatListRefreshNonce}
            presenceMap={presenceMap}
            onSelectChat={setSelectedChat}
            selectedChatId={selectedChat?.id}
            onCreateGroup={() => setShowCreateGroup(true)}
            compactMode={uiSettings.compactMode}
          />
          <nav className="mobile-tab-bar">
            <button className="tab-item active">
              <MessageSquare size={22} />
              <span>Чаты</span>
            </button>
            <button className="tab-item" onClick={() => {}}>
              <Phone size={22} />
              <span>Звонки</span>
            </button>
            <button className="tab-item" onClick={() => {}}>
              <Users size={22} />
              <span>Контакты</span>
            </button>
            <button className="tab-item" onClick={() => setShowSettings(true)}>
              <Settings size={22} />
              <span>Настройки</span>
            </button>
          </nav>
        </div>
        <div className="chat-area">
          {selectedChat ? (
            <ChatWindow
              token={token}
              user={user}
              chat={selectedChat}
              globalWsRef={wsRef}
              wsConnected={wsConnected}
              liveIncomingMessages={liveMessages[selectedChat.id] || []}
              onInitiateCall={initiateCall}
              onBack={() => setSelectedChat(null)}
              onChatDeleted={() => setChatListRefreshNonce(prev => prev + 1)}
              compactMode={uiSettings.compactMode}
              bubbleStyle={uiSettings.bubbleStyle}
              animations={uiSettings.animations}
              onOutgoingMessageTone={playOutgoingMessageSound}
              onIncomingMessageTone={playIncomingMessageSound}
            />
          ) : (
            <div className="empty-chat-view">
              <div className="empty-chat-card glass">
                <div className="empty-chat-title">Выбери чат или пользователя слева</div>
                <div className="empty-chat-text">Личные чаты, голосовые сообщения, звонки и файлы.</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {callState && (
        <CallModal
          callState={callState}
          partnerName={callPartner?.display_name || 'Вызов'}
          onAccept={acceptCall}
          onDecline={() => {
            if (callPartner?.id) sendCallSignal('call:reject', callPartner.id, { call_id: currentCallIdRef.current })
            endCallCleanUp()
          }}
          onEndCall={() => {
            if (callPartner?.id) sendCallSignal('call:end', callPartner.id, { call_id: currentCallIdRef.current })
            endCallCleanUp()
          }}
          localStream={localStream}
          remoteStream={remoteStream}
          remoteAudioStream={remoteAudioStream}
          remoteVideoStream={remoteVideoStream}
          callDebug={callDebug}
          isAudioMuted={isAudioMuted}
          isVideoMuted={isVideoMuted}
          toggleAudio={toggleAudio}
          toggleVideo={toggleVideo}
          ringtoneStyle={uiSettings.callRingtone || 'classic'}
        />
      )}

      {showQRModal && (
        <div className="modal-overlay" onClick={() => setShowQRModal(false)}>
          <div className="glass qr-share-modal" onClick={e => e.stopPropagation()}>
            <div className="qr-share-title">Вход на другом устройстве</div>
            <div className="qr-share-text">Открой экран входа на новом устройстве и нажми «Войти по QR-коду».</div>
            <div className="qr-canvas-wrap" style={{ background: '#fff', padding: 16, borderRadius: 20 }}>
              <QRCodeSVG value={qrPayload} size={280} includeMargin level="L" bgColor="#ffffff" fgColor="#111827" />
            </div>
          </div>
        </div>
      )}

      {showAdminPanel && <AdminPanel token={token} onClose={() => setShowAdminPanel(false)} />}
      {showSettings && (
        <SettingsPanel
          token={token}
          user={user}
          settings={uiSettings}
          onChange={setUiSettings}
          onClose={() => setShowSettings(false)}
          onAvatarUpdated={handleAvatarUploaded}
        />
      )}
      {showCreateGroup && (
        <CreateGroupModal
          token={token}
          user={user}
          onClose={() => setShowCreateGroup(false)}
          onCreate={(chat) => {
            setChatListRefreshNonce(prev => prev + 1)
            if (chat) setSelectedChat(chat)
          }}
        />
      )}
    </>
  )
}

export default App
