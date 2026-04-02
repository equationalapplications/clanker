import { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import { Text, Button } from 'react-native-paper'
import { useRouter } from 'expo-router'
import { supabaseClient } from '~/config/supabaseClient'

export default function CheckoutSuccess() {
    const router = useRouter()

    useEffect(() => {
        const timer = setTimeout(async () => {
            const { error } = await supabaseClient.auth.refreshSession()
            if (error) console.warn('⚠️ Session refresh failed after checkout:', error.message)
            router.replace('/')
        }, 3000)
        return () => clearTimeout(timer)
    }, [router])

    return (
        <View style={styles.container}>
            <Text variant="headlineMedium" style={styles.title}>
                Purchase complete!
            </Text>
            <Text variant="bodyLarge" style={styles.subtitle}>
                Your subscription is now active. Redirecting you back…
            </Text>
            <Button mode="contained" onPress={async () => {
                const { error } = await supabaseClient.auth.refreshSession()
                if (error) console.warn('⚠️ Session refresh failed after checkout:', error.message)
                router.replace('/')
            }} style={styles.button}>
                Go to app
            </Button>
        </View>
    )
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        gap: 16,
    },
    title: {
        textAlign: 'center',
    },
    subtitle: {
        textAlign: 'center',
        opacity: 0.7,
    },
    button: {
        marginTop: 8,
    },
})
