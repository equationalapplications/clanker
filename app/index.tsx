import { Redirect } from 'expo-router';
import { View, ActivityIndicator } from 'react-native';
import { useAuth } from '~/auth/useAuth';

export default function Index() {
    const { user, isLoading } = useAuth();

    console.log('[Index] Render - isLoading:', isLoading, 'user:', !!user);

    // Show loading indicator while checking auth state
    if (isLoading) {
        return (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                <ActivityIndicator size="large" />
            </View>
        );
    }

    // Explicitly redirect based on auth state
    // This works with Stack.Protected to ensure proper routing
    if (user) {
        console.log('[Index] User authenticated, redirecting to app');
        return <Redirect href="/(app)/(tabs)/chats" />;
    }

    console.log('[Index] No user, redirecting to sign-in');
    return <Redirect href="/sign-in" />;
}
