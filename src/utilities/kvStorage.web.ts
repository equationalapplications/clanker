/**
 * Platform-specific key-value storage — web implementation.
 * Uses localStorage which is synchronous and doesn't require SharedArrayBuffer.
 * expo-sqlite/kv-store's sync APIs need cross-origin isolation (SharedArrayBuffer),
 * which conflicts with Firebase Auth popup flows (COOP: same-origin-allow-popups).
 */
export const Storage = {
    getItemSync(key: string): string | null {
        return localStorage.getItem(key)
    },
    setItemSync(key: string, value: string): void {
        localStorage.setItem(key, value)
    },
    async getItem(key: string): Promise<string | null> {
        return localStorage.getItem(key)
    },
    async setItem(key: string, value: string): Promise<void> {
        localStorage.setItem(key, value)
    },
    async removeItem(key: string): Promise<void> {
        localStorage.removeItem(key)
    },
}
