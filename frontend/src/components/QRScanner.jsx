import React, { useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'
import { X, ScanLine } from 'lucide-react'

export default function QRScanner({ onScan, onClose }) {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const [error, setError] = useState(null)
  const scannedRef = useRef(false)

  useEffect(() => {
    let stream = null
    let scanIntervalId = null
    let mounted = true
    const decodeIntervalMs = 500
    const maxScanWidth = 480
    const BarcodeDetectorCtor = window.BarcodeDetector
    let detector = null
    let detecting = false
    if (BarcodeDetectorCtor) {
      try {
        detector = new BarcodeDetectorCtor({ formats: ['qr_code'] })
      } catch {
        detector = null
      }
    }

    const startCamera = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 }
          }
        })
      } catch (err) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: true })
        } catch {
          setError('Доступ к камере запрещен')
        }
      }

      if (stream && videoRef.current && mounted) {
        videoRef.current.srcObject = stream
        videoRef.current.setAttribute('playsinline', 'true')
        videoRef.current.setAttribute('autoplay', 'true')
        videoRef.current.setAttribute('muted', 'true')
        await videoRef.current.play().catch(() => {})
        scanIntervalId = window.setInterval(tick, decodeIntervalMs)
      }
    }

    const tick = () => {
      if (!mounted || scannedRef.current) return
      if (videoRef.current && canvasRef.current && videoRef.current.readyState === videoRef.current.HAVE_ENOUGH_DATA) {
        const canvas = canvasRef.current
        const video = videoRef.current
        const sourceWidth = video.videoWidth || 0
        const sourceHeight = video.videoHeight || 0
        if (!sourceWidth || !sourceHeight) {
          return
        }

        const cropSize = Math.floor(Math.min(sourceWidth, sourceHeight) * 0.72)
        const sx = Math.max(0, Math.floor((sourceWidth - cropSize) / 2))
        const sy = Math.max(0, Math.floor((sourceHeight - cropSize) / 2))
        const scale = Math.min(1, maxScanWidth / cropSize)
        const targetWidth = Math.max(220, Math.round(cropSize * scale))
        const targetHeight = targetWidth

        if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
          canvas.width = targetWidth
          canvas.height = targetHeight
        }

        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (!ctx) {
          return
        }
        ctx.drawImage(video, sx, sy, cropSize, cropSize, 0, 0, targetWidth, targetHeight)

        if (detector) {
          if (detecting) return
          detecting = true
          detector.detect(canvas).then((codes) => {
            detecting = false
            if (!mounted || scannedRef.current) return
            const data = codes?.[0]?.rawValue
            if (data) {
              scannedRef.current = true
              onScan(data)
            }
          }).catch(() => {
            detecting = false
          })
          return
        }

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'attemptBoth' })
        if (code?.data) {
          scannedRef.current = true
          onScan(code.data)
        }
      }
    }

    startCamera()

    return () => {
      mounted = false
      if (stream) stream.getTracks().forEach(t => t.stop())
      if (scanIntervalId) window.clearInterval(scanIntervalId)
    }
  }, [onScan])

  return (
    <div className="qr-scanner-overlay">
      <div className="glass qr-scanner-modal">
        <button onClick={onClose} className="qr-close-btn">
          <X size={20} />
        </button>
        <h3>Сканируй QR-код</h3>
        {error ? (
          <div className="qr-error">{error}</div>
        ) : (
          <div className="qr-video-wrap">
            <video ref={videoRef} muted className="qr-video" />
            <canvas ref={canvasRef} style={{ display: 'none' }} />
            <div className="qr-focus-frame">
              <ScanLine size={24} />
            </div>
          </div>
        )}
        <p className="qr-tip">Наведи камеру на QR-код, который открыт на другом устройстве.</p>
      </div>
    </div>
  )
}
