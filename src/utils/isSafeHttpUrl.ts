/** True only for http(s) URLs — used to gate which citation links we open. */
export function isSafeHttpUrl(uri: string): boolean {
  try {
    const { protocol } = new URL(uri)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}
