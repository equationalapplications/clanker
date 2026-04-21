import { useCallback } from 'react'
import { useAuthMachine } from '~/hooks/useMachines'
import type { BootstrapRefreshReason } from '~/machines/authMachine'

export function requestBootstrapRefresh(
  authService: { send: (event: { type: 'REFRESH_BOOTSTRAP'; reason: BootstrapRefreshReason }) => void },
  reason: BootstrapRefreshReason,
): void {
  authService.send({ type: 'REFRESH_BOOTSTRAP', reason })
}

export function useBootstrapRefresh() {
  const authService = useAuthMachine()

  return useCallback(
    (reason: BootstrapRefreshReason) => {
      requestBootstrapRefresh(authService, reason)
    },
    [authService],
  )
}
