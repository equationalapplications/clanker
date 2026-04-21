const ALLOWED_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])
const DEFAULT_IMAGE_MIME_TYPE = 'image/webp'

export function sanitizeImageMimeType(mimeType: string | null | undefined): string {
  const normalized = typeof mimeType === 'string' ? mimeType.trim().toLowerCase() : ''
  return ALLOWED_IMAGE_MIME_TYPES.has(normalized) ? normalized : DEFAULT_IMAGE_MIME_TYPE
}
