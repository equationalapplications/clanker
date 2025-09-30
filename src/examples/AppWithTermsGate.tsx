// Example of how to integrate TermsGate into your app with navigation

import React from 'react';
import { View } from 'react-native';
import { Text } from 'react-native-paper';
import { TermsGate } from '../components/TermsGate';
import { useUser } from '../hooks/useUser';

// Example: Wrap your main app content with TermsGate
export function AppWithTermsGate() {
    const user = useUser();

    const handleTermsAccepted = () => {
        console.log('User accepted terms - app can now function normally');
        // You might want to refresh user data, navigate to main screen, etc.
    };

    const handleTermsDeclined = () => {
        console.log('User declined terms - consider signing them out');
        // You might want to sign out the user or show a message
    };

    const handleNavigateToTerms = () => {
        console.log('User wants to view full terms');
        // Navigate to the Terms screen
        // If using React Navigation:
        // navigation.navigate('Terms');

        // If using Expo Router:
        // router.push('/terms');

        // For now, this is just a placeholder
        alert('Navigate to Terms screen - implement navigation based on your routing setup');
    };

    if (!user) {
        return (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                <Text>Please sign in to continue</Text>
            </View>
        );
    }

    return (
        <TermsGate
            appName="yours-brightly"
            onTermsAccepted={handleTermsAccepted}
            onTermsDeclined={handleTermsDeclined}
            onNavigateToTerms={handleNavigateToTerms}
        >
            {/* Your main app content goes here */}
            <YourMainAppContent />
        </TermsGate>
    );
} function YourMainAppContent() {
    return (
        <View style={{ flex: 1, padding: 20 }}>
            <Text variant="headlineMedium">Welcome to Yours Brightly!</Text>
            <Text variant="bodyMedium">
                You have accepted the terms and can now use the app.
            </Text>
            {/* Rest of your app content */}
        </View>
    );
}

export default AppWithTermsGate;