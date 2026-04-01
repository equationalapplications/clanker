import { StyleSheet, View } from 'react-native'
import { Text, Button } from 'react-native-paper'
import { useRouter } from 'expo-router'

export default function CheckoutCancel() {
    const router = useRouter()

    return (
        <View style={styles.container}>
            <Text variant="headlineMedium" style={styles.title}>
                Checkout cancelled
            </Text>
            <Text variant="bodyLarge" style={styles.subtitle}>
                No charge was made. You can try again whenever {"you're"} ready.
            </Text>
            <Button mode="contained" onPress={() => router.back()} style={styles.button}>
                Try again
            </Button>
            <Button mode="text" onPress={() => router.replace('/(drawer)')}>
                Back to app
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
