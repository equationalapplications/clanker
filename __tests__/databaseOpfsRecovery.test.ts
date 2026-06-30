import { isDatabaseStorageConflictError } from '~/database'

describe('isDatabaseStorageConflictError', () => {
  it('returns true for locked-in-browser-storage message', () => {
    expect(
      isDatabaseStorageConflictError(
        new Error('Database "clanker.db" is locked in browser storage. Close other tabs.'),
      ),
    ).toBe(true)
  })

  it('returns true for Invalid VFS state (poisoned expo-sqlite worker)', () => {
    expect(isDatabaseStorageConflictError(new Error('Invalid VFS state'))).toBe(true)
  })

  it('returns true for OPFS createSyncAccessHandle errors', () => {
    expect(
      isDatabaseStorageConflictError(
        new Error('Access Handles cannot be created for files in OPFS'),
      ),
    ).toBe(true)
  })

  it('returns true for database open timeout waiting on browser storage', () => {
    expect(
      isDatabaseStorageConflictError(
        new Error('Database "clanker.db" timed out waiting for browser storage'),
      ),
    ).toBe(true)
  })

  it('returns false for unrelated database errors', () => {
    expect(isDatabaseStorageConflictError(new Error('SQLITE_CORRUPT'))).toBe(false)
  })

  it('returns false for null/undefined', () => {
    expect(isDatabaseStorageConflictError(null)).toBe(false)
    expect(isDatabaseStorageConflictError(undefined)).toBe(false)
  })
})
