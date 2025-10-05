import { Redirect, router } from 'expo-router';
import { useSubscriptionStatus } from '~/hooks/useSubscriptionStatus';
import { ActivityIndicator, View } from 'react-native';
import { useEffect } from 'react';
import { Drawer } from 'expo-router/drawer';
import { useTheme, Icon } from 'react-native-paper';

export default function AppLayout() {
    const { needsTermsAcceptance, isUpdate, isLoading } = useSubscriptionStatus();
    const theme = useTheme();

    console.log('[AppLayout] Render - isLoading:', isLoading, 'needsTermsAcceptance:', needsTermsAcceptance, 'isUpdate:', isUpdate);

    useEffect(() => {
        console.log('[AppLayout] useEffect triggered - isLoading:', isLoading, 'needsTermsAcceptance:', needsTermsAcceptance);
        if (!isLoading && needsTermsAcceptance) {
            console.log('[AppLayout] Redirecting to accept-terms');
            router.replace({
                pathname: '/accept-terms',
                params: { isUpdate: isUpdate.toString() }
            });
        }
    }, [isLoading, needsTermsAcceptance, isUpdate]);

    if (isLoading) {
        console.log('[AppLayout] Showing loading indicator');
        return (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                <ActivityIndicator size="large" />
            </View>
        );
    }

    if (needsTermsAcceptance) {
        console.log('[AppLayout] Rendering Redirect to accept-terms');
        return <Redirect href="/accept-terms" />;
    }

    console.log('[AppLayout] Rendering Drawer navigation');
    return (
        <Drawer
            screenOptions={{
                headerStyle: { backgroundColor: theme.colors.surface },
                headerTintColor: theme.colors.onSurface,
                drawerStyle: { backgroundColor: theme.colors.surface },
                drawerActiveTintColor: theme.colors.primary,
                drawerInactiveTintColor: theme.colors.onSurfaceVariant,
            }}
        >
            <Drawer.Screen
                name="(tabs)"
                options={{
                    drawerLabel: 'Home',
                    title: 'Home',
                    drawerIcon: ({ color, size }) => <Icon source="home" color={color} size={size} />,
                }}
            />
            <Drawer.Screen
                name="settings"
                options={{
                    drawerLabel: 'Settings',
                    title: 'Settings',
                    drawerIcon: ({ color, size }) => <Icon source="cog" color={color} size={size} />,
                }}
            />
            <Drawer.Screen
                name="profile"
                options={{
                    drawerLabel: 'Profile',
                    title: 'Profile',
                    drawerIcon: ({ color, size }) => <Icon source="account-circle" color={color} size={size} />,
                }}
            />
        </Drawer>
    );
}
