import React from "react"
import { StyleSheet, ScrollView, View } from "react-native"
import { Text, List, Switch, Button, Divider } from "react-native-paper"
import { useAuth } from "../../../src/hooks/useAuth"
// import { useRouter } from "expo-router"

export default function Settings() {
    const { user, supabaseUser, signOut } = useAuth()
    // const router = useRouter()
    const [darkMode, setDarkMode] = React.useState(false)
    const [notifications, setNotifications] = React.useState(true)
    const [analytics, setAnalytics] = React.useState(false)

    return (
        <ScrollView style={styles.container}>
            <View style={styles.section}>
                <Text variant="headlineSmall" style={styles.sectionTitle}>Account</Text>

                {user && (
                    <List.Item
                        title="Email"
                        description={user.email || "No email"}
                        left={(props) => <List.Icon {...props} icon="email" />}
                    />
                )}

                {supabaseUser && (
                    <List.Item
                        title="User ID"
                        description={supabaseUser.id.substring(0, 8) + "..."}
                        left={(props) => <List.Icon {...props} icon="account" />}
                    />
                )}
            </View>

            <Divider />

            <View style={styles.section}>
                <Text variant="headlineSmall" style={styles.sectionTitle}>Preferences</Text>

                <List.Item
                    title="Dark Mode"
                    description="Use dark theme"
                    left={(props) => <List.Icon {...props} icon="theme-light-dark" />}
                    right={() => (
                        <Switch
                            value={darkMode}
                            onValueChange={setDarkMode}
                        />
                    )}
                />

                <List.Item
                    title="Notifications"
                    description="Receive push notifications"
                    left={(props) => <List.Icon {...props} icon="bell" />}
                    right={() => (
                        <Switch
                            value={notifications}
                            onValueChange={setNotifications}
                        />
                    )}
                />

                <List.Item
                    title="Analytics"
                    description="Help improve the app"
                    left={(props) => <List.Icon {...props} icon="chart-line" />}
                    right={() => (
                        <Switch
                            value={analytics}
                            onValueChange={setAnalytics}
                        />
                    )}
                />
            </View>

            <Divider />

            <View style={styles.section}>
                <Text variant="headlineSmall" style={styles.sectionTitle}>About</Text>

                {/* Commented out - these would navigate to the public routes */}
                {/*
                <List.Item
                    title="Terms of Service"
                    left={(props) => <List.Icon {...props} icon="file-document" />}
                    right={(props) => <List.Icon {...props} icon="chevron-right" />}
                    onPress={() => router.push("/terms")}
                />
                
                <List.Item
                    title="Privacy Policy"
                    left={(props) => <List.Icon {...props} icon="shield-check" />}
                    right={(props) => <List.Icon {...props} icon="chevron-right" />}
                    onPress={() => router.push("/privacy")}
                />
                */}

                <List.Item
                    title="App Version"
                    description="10.0.0"
                    left={(props) => <List.Icon {...props} icon="information" />}
                />
            </View>

            <Divider />

            <View style={styles.section}>
                <Button
                    mode="outlined"
                    onPress={signOut}
                    icon="logout"
                    style={styles.signOutButton}
                >
                    Sign Out
                </Button>
            </View>
        </ScrollView>
    )
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: "transparent",
    },
    section: {
        padding: 16,
    },
    sectionTitle: {
        marginBottom: 8,
        fontWeight: "600",
    },
    signOutButton: {
        marginTop: 16,
    },
})