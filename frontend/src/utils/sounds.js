let audioCtx = null
let userInteracted = false
let unlockBound = false

function getAudioCtx() {
  if (typeof window === 'undefined') return null
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return null
    audioCtx = new Ctx()
  }
  return audioCtx
}

async function unlockAudio() {
  userInteracted = true
  const ctx = getAudioCtx()
  if (!ctx) return
  if (ctx.state === 'suspended') {
    try { await ctx.resume() } catch {}
  }
}

function ensureUnlockListener() {
  if (typeof window === 'undefined' || unlockBound) return
  unlockBound = true
  const unlock = () => {
    unlockAudio().finally(() => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
      unlockBound = false
    })
  }
  window.addEventListener('pointerdown', unlock, { once: true })
  window.addEventListener('keydown', unlock, { once: true })
}

function withOscillator(builder) {
  const ctx = getAudioCtx()
  if (!ctx) return false
  ensureUnlockListener()
  if (!userInteracted && ctx.state !== 'running') return false

  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.connect(gain)
  gain.connect(ctx.destination)
  builder(ctx, osc, gain)
  return true
}

const VOLUME_BOOST = 1.7

export function playPing() {
  return withOscillator((ctx, osc, gain) => {
    osc.type = 'sine'
    osc.frequency.setValueAtTime(880, ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.15)
    gain.gain.setValueAtTime(0.3 * VOLUME_BOOST, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15)
    osc.start()
    osc.stop(ctx.currentTime + 0.15)
  })
}

export function playNotifyTone(preset = 'soft') {
  if (preset === 'silent') return false
  if (preset === 'bright') {
    return withOscillator((ctx, osc, gain) => {
      osc.type = 'sine'
      osc.frequency.setValueAtTime(1046, ctx.currentTime)
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.12)
      gain.gain.setValueAtTime(0.22 * VOLUME_BOOST, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.12)
      osc.start()
      osc.stop(ctx.currentTime + 0.12)
    })
  }
  if (preset === 'deep') {
    return withOscillator((ctx, osc, gain) => {
      osc.type = 'triangle'
      osc.frequency.setValueAtTime(392, ctx.currentTime)
      osc.frequency.exponentialRampToValueAtTime(330, ctx.currentTime + 0.18)
      gain.gain.setValueAtTime(0.2 * VOLUME_BOOST, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.18)
      osc.start()
      osc.stop(ctx.currentTime + 0.18)
    })
  }
  return playPing()
}

function createTone(frequency, duration = 0.18, type = 'sine', gainValue = 0.06) {
  return withOscillator((ctx, osc, gain) => {
    osc.type = type
    osc.frequency.setValueAtTime(frequency, ctx.currentTime)
    gain.gain.setValueAtTime(gainValue * VOLUME_BOOST, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration)
    osc.start()
    osc.stop(ctx.currentTime + duration)
  })
}

export function playMessageTone(direction = 'incoming', preset = 'soft') {
  if (preset === 'silent') return false
  if (direction === 'outgoing') {
    if (preset === 'bright') {
      return withOscillator((ctx, osc, gain) => {
        osc.type = 'triangle'
        osc.frequency.setValueAtTime(988, ctx.currentTime)
        osc.frequency.exponentialRampToValueAtTime(1174, ctx.currentTime + 0.08)
        gain.gain.setValueAtTime(0.18 * VOLUME_BOOST, ctx.currentTime)
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.09)
        osc.start()
        osc.stop(ctx.currentTime + 0.09)
      })
    }
    if (preset === 'deep') {
      return withOscillator((ctx, osc, gain) => {
        osc.type = 'sine'
        osc.frequency.setValueAtTime(420, ctx.currentTime)
        osc.frequency.exponentialRampToValueAtTime(360, ctx.currentTime + 0.11)
        gain.gain.setValueAtTime(0.16 * VOLUME_BOOST, ctx.currentTime)
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.11)
        osc.start()
        osc.stop(ctx.currentTime + 0.11)
      })
    }
    return withOscillator((ctx, osc, gain) => {
      osc.type = 'sine'
      osc.frequency.setValueAtTime(740, ctx.currentTime)
      osc.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.1)
      gain.gain.setValueAtTime(0.17 * VOLUME_BOOST, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1)
      osc.start()
      osc.stop(ctx.currentTime + 0.1)
    })
  }
  return playNotifyTone(preset)
}

export function startIncomingRingtone(style = 'classic') {
  let stopped = false
  const tick = () => {
    if (stopped) return
    if (style === 'digital') {
      if (!createTone(932, 0.14, 'triangle', 0.08)) return
      setTimeout(() => { if (!stopped) createTone(1175, 0.14, 'triangle', 0.07) }, 180)
      setTimeout(() => { if (!stopped) createTone(932, 0.14, 'triangle', 0.07) }, 360)
      return
    }
    if (style === 'retro') {
      if (!createTone(523, 0.2, 'square', 0.065)) return
      setTimeout(() => { if (!stopped) createTone(659, 0.2, 'square', 0.065) }, 230)
      return
    }
    if (!createTone(784, 0.22, 'sine', 0.07)) return
    setTimeout(() => { if (!stopped) createTone(659, 0.22, 'sine', 0.06) }, 260)
  }
  tick()
  const interval = setInterval(tick, 2200)
  return {
    stop() {
      stopped = true
      clearInterval(interval)
    },
  }
}

export function startOutgoingCallTone(style = 'classic') {
  let stopped = false
  const tick = () => {
    if (stopped) return
    if (style === 'digital') {
      if (!createTone(620, 0.1, 'triangle', 0.06)) return
      setTimeout(() => { if (!stopped) createTone(760, 0.1, 'triangle', 0.055) }, 180)
      return
    }
    if (style === 'retro') {
      if (!createTone(440, 0.12, 'square', 0.05)) return
      setTimeout(() => { if (!stopped) createTone(440, 0.12, 'square', 0.05) }, 220)
      return
    }
    if (!createTone(460, 0.12, 'triangle', 0.055)) return
    setTimeout(() => { if (!stopped) createTone(460, 0.12, 'triangle', 0.055) }, 220)
  }
  tick()
  const interval = setInterval(tick, 1800)
  return {
    stop() {
      stopped = true
      clearInterval(interval)
    },
  }
}
