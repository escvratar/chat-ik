export async function resizeImageFile(file, options = {}) {
  const {
    maxSize = 256,
    type = 'image/webp',
    quality = 0.86,
    square = false,
    output = 'dataUrl',
  } = options

  if (!file) return null

  const objectUrl = URL.createObjectURL(file)
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = reject
      el.src = objectUrl
    })

    const sourceWidth = img.width || 1
    const sourceHeight = img.height || 1
    const max = Math.max(1, Number(maxSize) || 256)

    let targetWidth = sourceWidth
    let targetHeight = sourceHeight
    let sx = 0
    let sy = 0
    let sWidth = sourceWidth
    let sHeight = sourceHeight

    if (square) {
      const side = Math.min(sourceWidth, sourceHeight)
      sx = Math.floor((sourceWidth - side) / 2)
      sy = Math.floor((sourceHeight - side) / 2)
      sWidth = side
      sHeight = side
      targetWidth = Math.min(max, side)
      targetHeight = Math.min(max, side)
    } else {
      const scale = Math.min(max / sourceWidth, max / sourceHeight, 1)
      targetWidth = Math.round(sourceWidth * scale)
      targetHeight = Math.round(sourceHeight * scale)
    }

    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, targetWidth)
    canvas.height = Math.max(1, targetHeight)
    const ctx = canvas.getContext('2d')
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, canvas.width, canvas.height)
    if (output === 'blob') {
      const blob = await new Promise((resolve) => {
        canvas.toBlob((b) => resolve(b), type, quality)
      })
      return blob
    }
    return canvas.toDataURL(type, quality)
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}
