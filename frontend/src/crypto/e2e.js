import nacl from 'tweetnacl'
import naclUtil from 'tweetnacl-util'

const { encodeBase64, decodeBase64, encodeUTF8, decodeUTF8 } = naclUtil

// ── Password-based Key Encryption (for Cloud Backup) ──

async function deriveKey(password, salt) {
  const encoder = new TextEncoder()
  const baseKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  )
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 100000,
      hash: 'SHA-256'
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  )
}

export async function encryptKeyWithPassword(secretKeyB64, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(password, salt)
  
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(secretKeyB64)
  )
  
  const combo = new Uint8Array(salt.length + iv.length + encrypted.byteLength)
  combo.set(salt)
  combo.set(iv, salt.length)
  combo.set(new Uint8Array(encrypted), salt.length + iv.length)
  
  return encodeBase64(combo)
}

export async function decryptKeyWithPassword(comboB64, password) {
  try {
    const combo = decodeBase64(comboB64)
    const salt = combo.slice(0, 16)
    const iv = combo.slice(16, 28)
    const encrypted = combo.slice(28)
    
    const key = await deriveKey(password, salt)
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      encrypted
    )
    
    return new TextDecoder().decode(decrypted)
  } catch (e) {
    console.error('Key decryption failed', e)
    return null
  }
}

// Generate new keypair for a user (called on registration/login)
export function generateKeyPair() {
  const keyPair = nacl.box.keyPair()
  return {
    publicKey: encodeBase64(keyPair.publicKey),
    secretKey: encodeBase64(keyPair.secretKey)
  }
}

// Encrypt a string message using our secret key and their public key
export function encryptMessage(text, mySecretKeyB64, theirPublicKeyB64) {
  const secretKey = decodeBase64(mySecretKeyB64)
  const publicKey = decodeBase64(theirPublicKeyB64)
  
  const nonce = nacl.randomBytes(nacl.box.nonceLength)
  const messageUint8 = decodeUTF8(text)
  
  const encrypted = nacl.box(messageUint8, nonce, publicKey, secretKey)
  
  // Package nonce + ciphertext together
  const fullMessage = new Uint8Array(nonce.length + encrypted.length)
  fullMessage.set(nonce)
  fullMessage.set(encrypted, nonce.length)
  
  return encodeBase64(fullMessage)
}

// Decrypt a message using our secret key and their public key
export function decryptMessage(encryptedB64, mySecretKeyB64, theirPublicKeyB64) {
  try {
    const secretKey = decodeBase64(mySecretKeyB64)
    const publicKey = decodeBase64(theirPublicKeyB64)
    if (secretKey.length !== nacl.box.secretKeyLength || publicKey.length !== nacl.box.publicKeyLength) {
      return '[Decryption failed]'
    }
    const fullMessage = decodeBase64(encryptedB64)
    
    const nonce = fullMessage.slice(0, nacl.box.nonceLength)
    const ciphertext = fullMessage.slice(nacl.box.nonceLength)
    
    const decryptedUint8 = nacl.box.open(ciphertext, nonce, publicKey, secretKey)
    if (!decryptedUint8) return '[Decryption failed]'
    
    return encodeUTF8(decryptedUint8)
  } catch {
    return '[Decryption crashed]'
  }
}

// ── File/Media Encryption (AES-GCM for speed + NacL Box for Key Wrapping) ──

// Encrypt binary data (Blob/ArrayBuffer)
export async function encryptFile(fileBuffer, mySecretKeyB64, theirPublicKeyB64) {
  // 1. Generate a random AES-256 key
  const aesKey = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  )
  const aesKeyRaw = await crypto.subtle.exportKey('raw', aesKey)
  
  // 2. Encrypt the file data with AES-GCM
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encryptedFileBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    fileBuffer
  )
  
  // 3. Encrypt the AES key itself with NacL Box (E2E)
  const wrappedKey = encryptMessage(encodeBase64(new Uint8Array(aesKeyRaw)), mySecretKeyB64, theirPublicKeyB64)
  
  return {
    encryptedBlob: new Blob([new Uint8Array(encryptedFileBuffer)]),
    iv: encodeBase64(iv),
    wrappedKey
  }
}

// Decrypt binary data
export async function decryptFile(encryptedBuffer, ivB64, wrappedKeyB64, mySecretKeyB64, theirPublicKeyB64) {
  try {
    // 1. Unwrap the AES key
    const aesKeyB64 = decryptMessage(wrappedKeyB64, mySecretKeyB64, theirPublicKeyB64)
    if (aesKeyB64 === '[Decryption failed]') throw new Error('Key unwrapping failed')
    
    const aesKeyRaw = decodeBase64(aesKeyB64)
    const iv = decodeBase64(ivB64)
    
    const aesKey = await crypto.subtle.importKey(
      'raw',
      aesKeyRaw,
      'AES-GCM',
      false,
      ['decrypt']
    )
    
    // 2. Decrypt the file data
    const decryptedBuffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      aesKey,
      encryptedBuffer
    )
    
    return decryptedBuffer
  } catch {
    return null
  }
}
