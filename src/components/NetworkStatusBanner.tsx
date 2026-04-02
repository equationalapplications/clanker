import { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { onlineManager } from '@tanstack/react-query'
import { useTheme } from 'react-native-paper'

/**
 * Shows a slim offline indicator bar at the top of the screen.
 * Renders nothing when the device is online.
 */
export function NetworkStatusBanner() {
    const [isOnline, setIsOnline] = useState(() => onlineManager.isOnline())
    const { colors } = useTheme()

    useEffect(() => {
        const unsubscribe = onlineManager.subscribe((online) => {
            setIsOnline(online)
        })
        return unsubscribe
    }, [])

    if (isOnline) return null

    return (
        <View style={[styles.banner, { backgroundColor: colors.inverseSurface }]}>
            <Text style={[styles.text, { color: colors.inverseOnSurface }]}>You&apos;re offline</Text>
        </View>
    )
}

const styles = StyleSheet.create({
    banner: {
        paddingVertical: 6,
        alignItems: 'center',
    },
    text: {
        fontSize: 12,
        fontWeight: '500',
    },
})
