/**
 * Uploaded profile pictures are normalized to a small square JPEG data URI
 * before they enter the store: the store is JSON on disk, and an original
 * camera photo would bloat it a thousandfold for a 56px circle.
 */
const AVATAR_SIZE_PX = 256
const AVATAR_JPEG_QUALITY = 0.85
const MAX_SOURCE_BYTES = 20 * 1024 * 1024

export async function imageFileToAvatarDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Choose an image file.')
  }
  if (file.size > MAX_SOURCE_BYTES) {
    throw new Error('That image is larger than 20 MB.')
  }
  const url = URL.createObjectURL(file)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image()
      element.onload = () => resolve(element)
      element.onerror = () => reject(new Error('That image could not be read.'))
      element.src = url
    })
    const side = Math.min(image.naturalWidth, image.naturalHeight)
    const canvas = document.createElement('canvas')
    canvas.width = AVATAR_SIZE_PX
    canvas.height = AVATAR_SIZE_PX
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Image processing is unavailable.')
    // Center-crop to a square, then scale down.
    context.drawImage(
      image,
      (image.naturalWidth - side) / 2,
      (image.naturalHeight - side) / 2,
      side,
      side,
      0,
      0,
      AVATAR_SIZE_PX,
      AVATAR_SIZE_PX,
    )
    return canvas.toDataURL('image/jpeg', AVATAR_JPEG_QUALITY)
  } finally {
    URL.revokeObjectURL(url)
  }
}
