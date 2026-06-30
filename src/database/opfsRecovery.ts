/** Native stub — OPFS auto-reload recovery is web-only. */
export const OPFS_AUTO_RELOAD_KEY = 'clanker-db-opfs-auto-reload'

export function clearOpfsAutoReloadFlag(): void {}

export function tryAutoReloadForOpfsConflict(): boolean {
  return false
}
