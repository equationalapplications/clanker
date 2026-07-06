import { randomUUID as expoRandomUUID } from 'expo-crypto'

/**
 * Generate a plain UUID v4 using expo-crypto (Hermes-safe) with
 * globalThis.crypto fallback for web and Node test environments.
 */
export function generateSecureUuid(): string {
    try {
        const uuid = expoRandomUUID()
        if (typeof uuid === 'string' && uuid.length > 0) return uuid
    } catch {
        // expo-crypto native module unavailable
    }

    const uuid = globalThis.crypto?.randomUUID?.()
    if (uuid) return uuid

    if (globalThis.crypto?.getRandomValues) {
        const bytes = new Uint8Array(16)
        globalThis.crypto.getRandomValues(bytes)
        bytes[6] = (bytes[6] & 0x0f) | 0x40
        bytes[8] = (bytes[8] & 0x3f) | 0x80
        const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
    }

    throw new Error('Secure random generator unavailable for UUID generation.')
}
