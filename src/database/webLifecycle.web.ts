import { useEffect } from 'react'
import { closeDatabase } from './index'
import { terminateSqliteWebWorker } from './sqliteWebWorker'

function releaseWebDatabaseLocks(): void {
  terminateSqliteWebWorker()
  void closeDatabase().catch((error) => {
    console.warn('[DB] Failed to close database on pagehide:', error)
  })
}

/**
 * Release OPFS locks when the SPA is hidden (navigation to static pages, bfcache).
 * Reload bfcache restores because terminating the worker orphans expo-sqlite's singleton.
 */
export function useWebDatabaseLifecycle(): void {
  useEffect(() => {
    if (typeof window === 'undefined') return

    const handlePageHide = (): void => {
      releaseWebDatabaseLocks()
    }

    const handlePageShow = (event: PageTransitionEvent): void => {
      if (!event.persisted) return
      console.warn('[DB] Restored from bfcache after storage teardown — reloading')
      window.location.reload()
    }

    window.addEventListener('pagehide', handlePageHide)
    window.addEventListener('pageshow', handlePageShow)
    return () => {
      window.removeEventListener('pagehide', handlePageHide)
      window.removeEventListener('pageshow', handlePageShow)
    }
  }, [])
}
