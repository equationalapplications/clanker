import { useEffect } from 'react'
import { usePathname } from 'expo-router'
import { logScreenView, waitForAnalyticsInit } from '~/services/analyticsService'

export function useScreenTracking(): void {
  const pathname = usePathname()

  useEffect(() => {
    let cancelled = false
    void waitForAnalyticsInit()
      .then(() => {
        if (!cancelled) logScreenView(pathname)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [pathname])
}
