import React, { useEffect, useRef, useState } from 'react'
import { PhoneOff, Phone, Mic, MicOff, Video, VideoOff, Minimize2, Maximize2 } from 'lucide-react'
import { startIncomingRingtone, startOutgoingCallTone } from '../utils/sounds.js'

export default function CallModal({
  callState,
  partnerName,
  onAccept,
  onDecline,
  onEndCall,
  localStream,
  remoteAudioStream,
  remoteVideoStream,
  callDebug,
  isAudioMuted,
  isVideoMuted,
  toggleAudio,
  toggleVideo,
  ringtoneStyle = 'classic',
}) {
  const localVideoRef = useRef(null)
  const remoteVideoRef = useRef(null)
  const remoteAudioRef = useRef(null)
  const previewFallbackRef = useRef(null)

  const [localCollapsed, setLocalCollapsed] = useState(false)

  const hasLocalVideo = !!localStream?.getVideoTracks?.().length
  const hasRemoteVideo = !!remoteVideoStream?.getVideoTracks?.().length
  const hasRemoteAudio = !!remoteAudioStream?.getAudioTracks?.().length
  const remoteMicMuted = !!(callDebug?.remoteAudioMuted?.length && callDebug.remoteAudioMuted.every(Boolean))
  const remoteCamMuted = !hasRemoteVideo || !!(callDebug?.remoteVideoMuted?.length && callDebug.remoteVideoMuted.every(Boolean))

  useEffect(() => {
    const video = localVideoRef.current
    const track = localStream?.getVideoTracks?.()?.[0]
    if (!video || !track) {
      if (video) video.srcObject = null
      return
    }

    let stopped = false
    let checkTimer = null
    const retryTimers = []
    const ensurePlay = () => video.play?.().catch(() => {})

    const attachTrackPreview = (previewTrack) => {
      if (!previewTrack) return
      video.srcObject = new MediaStream([previewTrack])
      ensurePlay()
      retryTimers.push(setTimeout(ensurePlay, 150))
      retryTimers.push(setTimeout(ensurePlay, 500))
      retryTimers.push(setTimeout(ensurePlay, 1000))
    }

    video.muted = true
    video.volume = 0
    video.setAttribute('muted', '')
    video.setAttribute('playsinline', '')
    video.setAttribute('autoplay', '')

    track.enabled = true
    attachTrackPreview(track)

    const attachFallbackPreview = async () => {
      if (stopped || (video.videoWidth || 0) > 0 || !navigator?.mediaDevices?.getUserMedia) return
      try {
        const fallback = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            width: { ideal: 320, max: 640 },
            height: { ideal: 240, max: 480 },
            frameRate: { ideal: 12, max: 24 },
            facingMode: 'user',
          },
        })
        if (stopped) {
          fallback.getTracks().forEach(t => t.stop())
          return
        }
        previewFallbackRef.current?.getTracks?.().forEach(t => t.stop())
        previewFallbackRef.current = fallback
        const fallbackTrack = fallback.getVideoTracks?.()?.[0]
        attachTrackPreview(fallbackTrack)
      } catch {}
    }

    checkTimer = setTimeout(attachFallbackPreview, 650)

    video.onloadedmetadata = ensurePlay
    video.oncanplay = ensurePlay
    track.onunmute = () => attachTrackPreview(track)
    track.onended = attachFallbackPreview

    return () => {
      stopped = true
      if (checkTimer) clearTimeout(checkTimer)
      retryTimers.forEach(t => clearTimeout(t))
      video.onloadedmetadata = null
      video.oncanplay = null
      track.onunmute = null
      track.onended = null
      video.srcObject = null
      previewFallbackRef.current?.getTracks?.().forEach(t => t.stop())
      previewFallbackRef.current = null
    }
  }, [localStream, callState, hasLocalVideo, localCollapsed])

  useEffect(() => {
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteVideoStream || null
      remoteVideoRef.current.play?.().catch(() => {})
    }
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = remoteAudioStream || null
      remoteAudioRef.current.play?.().catch(() => {})
    }
  }, [remoteAudioStream, remoteVideoStream])

  useEffect(() => {
    let controller = null
    if (callState === 'incoming') controller = startIncomingRingtone(ringtoneStyle)
    if (callState === 'outgoing') controller = startOutgoingCallTone(ringtoneStyle)
    return () => controller?.stop?.()
  }, [callState, ringtoneStyle])

  return (
    <div className="call-modal-overlay">
      <div className="call-modal-panel glass">
        <div className="call-modal-head">
          <h2 className="call-modal-title">
            {callState === 'incoming' ? 'Входящий звонок...' : callState === 'outgoing' ? 'Звоним...' : 'Разговор'}
          </h2>
          <div className="call-modal-partner">{partnerName}</div>
        </div>
        <audio ref={remoteAudioRef} autoPlay playsInline />

        {(callState === 'active' || localStream) && (
          <div className="call-video-stage">
            {hasLocalVideo && callState !== 'active' && (
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className="call-preconnect-local"
              />
            )}
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              muted
              className="call-remote-video"
              style={{ display: callState === 'active' && hasRemoteVideo ? 'block' : 'none' }}
            />
            {(!remoteVideoStream || !hasRemoteVideo) && callState === 'active' && (
              <div className="call-remote-placeholder">
                <span className="animate-pulse">{hasRemoteAudio ? 'Аудиосоединение установлено' : 'Соединение...'}</span>
              </div>
            )}
            {callState === 'active' && (
              <div className="call-remote-state">
                {remoteMicMuted && <span className="call-state-chip">Собеседник выключил микрофон</span>}
                {remoteCamMuted && <span className="call-state-chip">Собеседник выключил камеру</span>}
              </div>
            )}
            {hasLocalVideo && callState === 'active' && (
              <div
                className={`call-local-preview ${localCollapsed ? 'collapsed' : ''}`}
              >
                <div className="call-local-bar">
                  <button
                    type="button"
                    className="call-local-mini-btn"
                    onClick={() => setLocalCollapsed(prev => !prev)}
                    title={localCollapsed ? 'Развернуть' : 'Свернуть'}
                  >
                    {localCollapsed ? <Maximize2 size={12} /> : <Minimize2 size={12} />}
                  </button>
                </div>
                {!localCollapsed && (
                  <video
                    ref={localVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className="call-local-video"
                  />
                )}
              </div>
            )}
          </div>
        )}

        <div className="call-controls">
          {callState === 'incoming' && (
            <>
              <button onClick={onAccept} className="call-btn call-btn-accept">
                <Phone size={20} /> Ответить
              </button>
              <button onClick={onDecline} className="call-btn call-btn-end">
                <PhoneOff size={20} /> Отклонить
              </button>
            </>
          )}

          {callState === 'outgoing' && (
            <button onClick={onEndCall} className="call-btn call-btn-end">
              <PhoneOff size={20} /> Отменить
            </button>
          )}

          {callState === 'active' && (
            <>
              <button onClick={toggleAudio} className="call-btn call-btn-tool">
                {isAudioMuted ? <MicOff size={24} color="#ef4444" /> : <Mic size={24} />}
              </button>
              <button onClick={toggleVideo} className="call-btn call-btn-tool">
                {isVideoMuted ? <VideoOff size={24} color="#ef4444" /> : <Video size={24} />}
              </button>
              <button onClick={onEndCall} className="call-btn call-btn-end">
                <PhoneOff size={20} /> Завершить
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
