import { useEffect } from 'react'
import { usePathname } from 'expo-router'
import { logScreenView } from '~/services/analyticsService'

export function useScreenTracking(): void {
  const pathname = usePathname()

  useEffect(() => {
    logScreenView(pathname)
  }, [pathname])
}
