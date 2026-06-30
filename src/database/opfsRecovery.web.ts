export const OPFS_AUTO_RELOAD_KEY = 'clanker-db-opfs-auto-reload'

export function clearOpfsAutoReloadFlag(): void {
  if (typeof sessionStorage === 'undefined') return
  sessionStorage.removeItem(OPFS_AUTO_RELOAD_KEY)
}

/**
 * Reload once when OPFS locks persist so a fresh expo-sqlite worker can open storage.
 * Returns true when a reload was triggered (caller should not continue).
 */
export function tryAutoReloadForOpfsConflict(): boolean {
  if (typeof window === 'undefined' || typeof sessionStorage === 'undefined') return false
  if (sessionStorage.getItem(OPFS_AUTO_RELOAD_KEY)) return false

  sessionStorage.setItem(OPFS_AUTO_RELOAD_KEY, '1')
  console.warn('[DB] OPFS conflict persists — reloading once to release storage locks')
  window.location.reload()
  return true
}
