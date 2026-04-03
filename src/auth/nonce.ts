import * as Crypto from 'expo-crypto'

/**
 * Generates a cryptographically random nonce string.
 * Uses rejection sampling to avoid modulo bias.
 */
export const generateNonce = (length = 32): string => {
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const charsetLength = charset.length
  const maxUnbiased = Math.floor(256 / charsetLength) * charsetLength

  let result = ''

  while (result.length < length) {
    const remaining = length - result.length
    const randomValues = Crypto.getRandomValues(new Uint8Array(remaining * 2))

    for (let i = 0; i < randomValues.length && result.length < length; i++) {
      const v = randomValues[i]
      if (v >= maxUnbiased) {
        continue
      }
      result += charset[v % charsetLength]
    }
  }

  return result
}

/**
 * Returns the SHA256 hex digest of the input string.
 * Used to hash the nonce before passing to Apple Sign-In.
 */
export const sha256 = async (input: string): Promise<string> => {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, input)
}
