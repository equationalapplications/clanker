import { Tabs } from "expo-router"
import React from "react"
import { useTheme, Icon } from "react-native-paper"

export default function TabsLayout() {
    const theme = useTheme()

    console.log('TabsLayout rendering with theme:', {
        primary: theme.colors.primary,
        surface: theme.colors.surface,
        onSurfaceVariant: theme.colors.onSurfaceVariant
    })

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
            }}
        >
            <Tabs.Screen
                name="index"
                options={{
                    href: null, // Hide from tab bar but keep for routing
                }}
            />
            <Tabs.Screen
                name="characters"
                options={{
                    title: "Characters",
                    tabBarIcon: ({ color, size }) => (
                        <Icon source="account-group" color={color} size={size} />
                    ),
                }}
            />
            <Tabs.Screen
                name="settings"
                options={{
                    title: "Settings",
                    tabBarIcon: ({ color, size }) => (
                        <Icon source="cog" color={color} size={size} />
                    ),
                }}
            />
        </Tabs>
    )
}