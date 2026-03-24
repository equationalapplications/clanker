/**
 * Network manager - bridges NetInfo to TanStack Query's onlineManager
 *
 * Call setupNetworkManager() once at app startup. Pass an optional onReconnect
 * callback to trigger work (e.g. cloud sync) whenever the device comes back online.
 */

import { onlineManager } from '@tanstack/react-query'
import NetInfo from '@react-native-community/netinfo'

/**
 * Subscribe to network changes and keep onlineManager in sync.
 * Calls onReconnect when transitioning from offline → online.
 *
 * @returns unsubscribe function (call on cleanup)
 */
export function setupNetworkManager(onReconnect?: () => void): () => void {
    let prevOnline = true

    return NetInfo.addEventListener((state) => {
        const isOnline =
            state.isConnected != null &&
            state.isConnected &&
            Boolean(state.isInternetReachable)

        onlineManager.setOnline(isOnline)

        if (isOnline && !prevOnline && onReconnect) {
            onReconnect()
        }

        prevOnline = isOnline
    })
}
