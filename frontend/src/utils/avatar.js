export function resolveAvatarUrl(userId, avatarObjectKey) {
  if (!userId || !avatarObjectKey) return null
  const encoded = encodeURIComponent(avatarObjectKey)
  return `/api/users/${userId}/avatar?v=${encoded}`
}
