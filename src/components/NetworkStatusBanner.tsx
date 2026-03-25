import { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { onlineManager } from '@tanstack/react-query'

/**
 * Shows a slim offline indicator bar at the top of the screen.
 * Renders nothing when the device is online.
 */
export function NetworkStatusBanner() {
    const [isOnline, setIsOnline] = useState(() => onlineManager.isOnline())

    useEffect(() => {
        const unsubscribe = onlineManager.subscribe((online) => {
            setIsOnline(online)
        })
        return unsubscribe
    }, [])

    if (isOnline) return null

    return (
        <View style={styles.banner}>
            <Text style={styles.text}>You're offline</Text>
        </View>
    )
}

const styles = StyleSheet.create({
    banner: {
        backgroundColor: '#374151',
        paddingVertical: 6,
        alignItems: 'center',
    },
    text: {
        color: '#F9FAFB',
        fontSize: 12,
        fontWeight: '500',
    },
})
