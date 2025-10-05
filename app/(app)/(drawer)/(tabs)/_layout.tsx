import { Tabs } from 'expo-router';
import { useTheme, Icon } from 'react-native-paper';

export default function TabsLayout() {
    const theme = useTheme();

    return (
        <Tabs
            screenOptions={{
                tabBarActiveTintColor: theme.colors.primary,
                tabBarInactiveTintColor: theme.colors.onSurfaceVariant,
                tabBarStyle: {
                    backgroundColor: theme.colors.surface,
                },
                headerShown: false,
            }}
        >
            <Tabs.Screen
                name="chats"
                options={{
                    title: 'Chats',
                    tabBarIcon: ({ color, size }) => <Icon source="chat" color={color} size={size} />,
                }}
            />
            <Tabs.Screen
                name="characters"
                options={{
                    title: 'Characters',
                    tabBarIcon: ({ color, size }) => <Icon source="account-group" color={color} size={size} />,
                }}
            />
        </Tabs>
    );
}
