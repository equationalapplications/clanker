export const TEXT_MIME_TYPES = ['text/plain', 'text/markdown'] as const

export const CONVERT_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/png',
  'image/jpeg',
  'image/webp',
])

/** Infer MIME type from filename when the picker omits mimeType metadata. */
export function resolveDocumentMimeType(
  filename: string,
  mimeType?: string | null,
): string | undefined {
  const normalizedMime = mimeType?.split(';')[0]?.trim().toLowerCase()
  if (
    normalizedMime &&
    (TEXT_MIME_TYPES.includes(normalizedMime as (typeof TEXT_MIME_TYPES)[number]) ||
      CONVERT_MIME_TYPES.has(normalizedMime))
  ) {
    return normalizedMime
  }

  const lowerName = filename.toLowerCase()
  if (lowerName.endsWith('.pdf')) return 'application/pdf'
  if (lowerName.endsWith('.docx')) {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  }
  if (lowerName.endsWith('.png')) return 'image/png'
  if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) return 'image/jpeg'
  if (lowerName.endsWith('.webp')) return 'image/webp'
  if (lowerName.endsWith('.txt')) return 'text/plain'
  if (lowerName.endsWith('.md')) return 'text/markdown'

  return undefined
}
