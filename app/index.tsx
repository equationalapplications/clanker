import { View } from 'react-native';

export default function Index() {
    // This is the root index. Stack.Protected in _layout.tsx will handle
    // redirecting to either the authenticated (app) group or sign-in based on auth state.
    // We render nothing here as the redirect happens automatically.
    return <View />;
}
