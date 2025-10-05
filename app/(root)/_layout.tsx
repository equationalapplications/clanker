import { Tabs } from "expo-router"
import { useTheme, Icon } from "react-native-paper"

export default function TabsLayout() {
    const theme = useTheme()

    return (
        <Tabs
            screenOptions={{
                tabBarActiveTintColor: theme.colors.primary,
                tabBarInactiveTintColor: theme.colors.onSurfaceVariant,
                tabBarStyle: {
                    backgroundColor: theme.colors.surface,
                    borderTopWidth: 1,
                    borderTopColor: theme.colors.outline,
                    height: 60, // Ensure visible height
                    display: 'flex', // Explicitly show the tab bar
                },
                headerStyle: {
                    backgroundColor: theme.colors.surface,
                },
                headerTintColor: theme.colors.onSurface,
                tabBarShowLabel: true, // Ensure labels are shown
                headerShown: false, // Hide the header to prevent route group names from showing
            }}
        >
            <Tabs.Screen
                name="index"
                options={{
                    href: null, // Hide from tab bar but keep for routing
                    headerShown: false,
                }}
            />
            <Tabs.Screen
                name="characters"
                options={{
                    title: "Characters",
                    tabBarIcon: ({ color, size }) => (
                        <Icon source="account-group" color={color} size={size} />
                    ),
                    headerShown: false, // Ensure no header for the main characters view
                }}
            />
            <Tabs.Screen
                name="settings"
                options={{
                    title: "Settings",
                    tabBarIcon: ({ color, size }) => (
                        <Icon source="cog" color={color} size={size} />
                    ),
                    headerShown: false, // Ensure no header for settings
                }}
            />
            <Tabs.Screen
                name="profile"
                options={{
                    href: null, // Hide from tab bar, accessible via navigation
                    title: "Profile",
                    headerShown: true,
                }}
            />
        </Tabs>
    )
}