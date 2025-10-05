import { Redirect, router } from 'expo-router';
import { useSubscriptionStatus } from '~/hooks/useSubscriptionStatus';
import { ActivityIndicator, View } from 'react-native';
import { useEffect } from 'react';
import { Drawer } from 'expo-router/drawer';
import { useTheme, Icon } from 'react-native-paper';

export default function AppLayout() {
    const { needsTermsAcceptance, isUpdate, isLoading } = useSubscriptionStatus();
    const theme = useTheme();

    useEffect(() => {
        if (!isLoading && needsTermsAcceptance) {
            router.replace({
                pathname: '/accept-terms',
                params: { isUpdate: isUpdate.toString() }
            });
        }
    }, [isLoading, needsTermsAcceptance, isUpdate]);

    if (isLoading) {
        return (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                <ActivityIndicator size="large" />
            </View>
        );
    }

    if (needsTermsAcceptance) {
        return <Redirect href="/accept-terms" />;
    }

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
