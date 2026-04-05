import { useEffect, useRef } from 'react'
import { generateKeyPair } from '../crypto/e2e.js'

export default function useKeyRotation(token, user) {
  const rotationTimer = useRef(null)
  const isProd = import.meta.env.PROD

  const rotateKey = async () => {
    if (!token || !user) return
    
    // 1. Generate new session key pair
    const keys = generateKeyPair()
    
    try {
      // 2. Publish to server
      const res = await fetch('/api/users/me/session-key', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}` 
        },
        body: JSON.stringify({ public_key: keys.publicKey })
      })
      
      if (res.ok) {
        const { id } = await res.json()
        
        // 3. Store in local history (for decryption of messages sent to this key)
        const historyKey = `chatik_sk_history_${user.id}`
        const history = JSON.parse(localStorage.getItem(historyKey) || '[]')
        
        // We keep the secret key and the ID assigned by the server
        history.push({ id, secretKey: keys.secretKey, publicKey: keys.publicKey, created: Date.now() })
        
        // Keep only last 48 keys (2 days) to avoid bloating storage
        if (history.length > 48) history.shift()
        
        localStorage.setItem(historyKey, JSON.stringify(history))
        localStorage.setItem(`chatik_current_sk_id_${user.id}`, id)
        
        if (!isProd) {
          console.log(`[PFS] Key rotated. New ID: ${id}`)
        }
      }
    } catch (err) {
      if (!isProd) {
        console.error('[PFS] Rotation failed', err)
      }
    }
  }

  useEffect(() => {
    if (token && user) {
      // Rotate immediately on app start
      rotateKey()
      
      // Setup hourly interval (3600000 ms)
      rotationTimer.current = setInterval(rotateKey, 3600000)
    }
    
    return () => {
      if (rotationTimer.current) clearInterval(rotationTimer.current)
    }
  }, [token, user?.id])

  return { rotateKey }
}
