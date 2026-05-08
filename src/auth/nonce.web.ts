const CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

/**
 * Generates a cryptographically random nonce string.
 * Uses rejection sampling to avoid modulo bias.
 *
 * @param length - The desired length of the nonce (default: 32). Must be a positive integer.
 * @returns A random nonce string of the specified length.
 * @throws {Error} If length is not a positive integer.
 */
export const generateNonce = (length = 32): string => {
  if (!Number.isInteger(length) || length < 1) {
    throw new Error(`Invalid nonce length: ${length}. Must be a positive integer.`)
  }

  const charsetLength = CHARSET.length
  const maxUnbiased = Math.floor(256 / charsetLength) * charsetLength

  let result = ''
  while (result.length < length) {
    const remaining = length - result.length
    const buf = new Uint8Array(remaining * 2)
    crypto.getRandomValues(buf)
    for (let i = 0; i < buf.length && result.length < length; i++) {
      const v = buf[i]
      if (v >= maxUnbiased) continue
      result += CHARSET[v % charsetLength]
    }
  }
  return result
}

/**
 * Returns the SHA256 hex digest of the input string.
 * Used to hash the nonce before passing to Apple Sign-In.
 *
 * @param input - The string to hash.
 * @returns A promise that resolves to the SHA256 hex digest (64 characters).
 */
export const sha256 = async (input: string): Promise<string> => {
  const data = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', data)
  const bytes = new Uint8Array(digest)
  let hex = ''
  for (const b of bytes) hex += b.toString(16).padStart(2, '0')
  return hex
}
