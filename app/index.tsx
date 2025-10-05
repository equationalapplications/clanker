import { Redirect } from 'expo-router';
import { useAuth } from '~/hooks/useAuth';

export default function Index() {
    const { user } = useAuth();

    // Explicitly redirect based on auth state
    // This works with Stack.Protected to ensure proper routing
    if (user) {
        return <Redirect href="/(app)/(tabs)/chats" />;
    }

    return <Redirect href="/sign-in" />;
}
