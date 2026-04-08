const RENEWAL_DATE_UTC_ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/

export const normalizeRenewalDateInput = (value: string): string | null => {
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return null
  }

  if (!RENEWAL_DATE_UTC_ISO_PATTERN.test(trimmed)) {
    return null
  }

  const parsedDate = new Date(trimmed)
  if (Number.isNaN(parsedDate.getTime())) {
    return null
  }

  const normalized = parsedDate.toISOString()
  return trimmed === normalized || trimmed === normalized.replace('.000Z', 'Z') ? normalized : null
}