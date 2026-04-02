import * as Crypto from 'expo-crypto'

/**
 * Generates a cryptographically random nonce string.
 */
export const generateNonce = (length = 32): string => {
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    const randomValues = Crypto.getRandomValues(new Uint8Array(length))
    return Array.from(randomValues)
        .map((v) => charset[v % charset.length])
        .join('')
}

/**
 * Returns the SHA256 hex digest of the input string.
 * Used to hash the nonce before passing to Apple Sign-In.
 */
export const sha256 = async (input: string): Promise<string> => {
    return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, input)
}
