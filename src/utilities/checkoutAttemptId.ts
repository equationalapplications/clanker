export function resolveCheckoutAttemptId(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' && value[0].length > 0 ? value[0] : null
  }

  return typeof value === 'string' && value.length > 0 ? value : null
}