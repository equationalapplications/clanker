import { Tabs } from "expo-router"
import React from "react"
import { MaterialCommunityIcons } from "@expo/vector-icons"
import { useTheme } from "react-native-paper"

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
                name="dashboard"
                options={{
                    title: "Dashboard",
                    tabBarIcon: ({ color, size }) => (
                        <MaterialCommunityIcons name="view-dashboard" color={color} size={size} />
                    ),
                }}
            />
            <Tabs.Screen
                name="settings"
                options={{
                    title: "Settings",
                    tabBarIcon: ({ color, size }) => (
                        <MaterialCommunityIcons name="cog" color={color} size={size} />
                    ),
                }}
            />
        </Tabs>
    )
}