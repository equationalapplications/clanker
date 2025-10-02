import { Stack } from "expo-router"

export default function CharactersLayout() {
    return (
        <Stack
            screenOptions={{
                headerShown: false, // Hide headers for all character screens since tabs handle the top-level navigation
            }}
        >
            <Stack.Screen
                name="index"
                options={{
                    headerShown: false,
                    title: "Characters" // This won't show but good for accessibility
                }}
            />
            <Stack.Screen
                name="edit/[id]"
                options={{
                    headerShown: true,
                    title: "Edit Character",
                    presentation: "card"
                }}
            />
            <Stack.Screen
                name="chat/[id]"
                options={{
                    headerShown: true,
                    title: "Chat",
                    presentation: "card"
                }}
            />
        </Stack>
    )
}