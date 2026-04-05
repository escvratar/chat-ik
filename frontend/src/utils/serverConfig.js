const STORAGE_KEY = 'chatik_server_url'

export function normalizeServerUrl(rawValue) {
  const raw = String(rawValue || '').trim()
  if (!raw) return ''
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  try {
    const parsed = new URL(withScheme)
    return parsed.origin
  } catch {
    return ''
  }
}

export function getDefaultServerUrl() {
  if (typeof window === 'undefined') return ''
  const protocol = window.location?.protocol || ''
  if (protocol === 'http:' || protocol === 'https:') {
    return window.location.origin
  }
  return ''
}

export function getServerBaseUrl() {
  if (typeof window === 'undefined') return ''
  const saved = normalizeServerUrl(localStorage.getItem(STORAGE_KEY))
  if (saved) return saved
  return getDefaultServerUrl()
}

export function setServerBaseUrl(value) {
  if (typeof window === 'undefined') return ''
  const normalized = normalizeServerUrl(value)
  if (normalized) {
    localStorage.setItem(STORAGE_KEY, normalized)
    return normalized
  }
  localStorage.removeItem(STORAGE_KEY)
  return ''
}

export function getServerLocationInfo() {
  const base = getServerBaseUrl()
  if (!base) return null
  try {
    const parsed = new URL(base)
    return {
      origin: parsed.origin,
      host: parsed.host,
      hostname: parsed.hostname,
      protocol: parsed.protocol,
      secure: parsed.protocol === 'https:',
    }
  } catch {
    return null
  }
}

export function createWsCandidates() {
  const info = getServerLocationInfo()
  if (!info?.host) return []
  const wsProto = info.secure ? 'wss:' : 'ws:'
  return [
    `${wsProto}//${info.host}/api/ws`,
    `${wsProto}//${info.host}/ws`,
  ]
}

function resolveServerUrl(input) {
  if (typeof input !== 'string') return input
  if (!/^\/api\/|^\/ws(?:$|\/)|^\/public\//.test(input)) return input
  const base = getServerBaseUrl()
  if (!base) return input
  return `${base}${input}`
}

export function installServerFetchShim() {
  if (typeof window === 'undefined' || window.__chatikFetchShimInstalled) return
  const nativeFetch = window.fetch.bind(window)
  window.fetch = (input, init) => {
    const resolved = resolveServerUrl(input)
    return nativeFetch(resolved, init)
  }
  window.__chatikFetchShimInstalled = true
}

