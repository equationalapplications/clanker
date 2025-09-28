import React from 'react'
import { View, StyleSheet, ScrollView, Alert } from 'react-native'
import { Text, Card, Button, Divider } from 'react-native-paper'
import { useAuth } from '../hooks/useAuth'
import { auth } from '../config/firebaseConfig'
import { supabase } from '../config/supabaseClient'
import LoadingIndicator from '../components/LoadingIndicator'

export default function Dashboard() {
    const { firebaseUser, supabaseUser, isLoading, error } = useAuth()

    const handleSignOut = async () => {
        try {
            // Sign out from both services
            await supabase.auth.signOut()
            await auth.signOut()
        } catch (err: any) {
            console.error('Sign out error:', err)
            Alert.alert('Sign Out Error', err.message || 'Failed to sign out')
        }
    }

    const formatDate = (timestamp: string | number | undefined | null) => {
        if (!timestamp) return 'N/A'
        return new Date(timestamp).toLocaleString()
    }

    const formatObject = (obj: any) => {
        if (!obj) return 'N/A'
        return JSON.stringify(obj, null, 2)
    }

    if (isLoading) {
        return (
            <View style={styles.container}>
                <LoadingIndicator />
                <Text style={styles.loadingText}>Authenticating with Supabase...</Text>
            </View>
        )
    }

    return (
        <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
            <Text style={styles.title}>User Dashboard</Text>

            {error && (
                <Card style={[styles.card, styles.errorCard]}>
                    <Card.Content>
                        <Text style={styles.errorText}>Authentication Error:</Text>
                        <Text style={styles.errorMessage}>{error}</Text>
                    </Card.Content>
                </Card>
            )}

            {/* Firebase User Info */}
            <Card style={styles.card}>
                <Card.Title title="🔥 Firebase User" subtitle="Google Authentication" />
                <Card.Content>
                    {firebaseUser ? (
                        <View>
                            <Text style={styles.label}>UID:</Text>
                            <Text style={styles.value}>{firebaseUser.uid}</Text>

                            <Text style={styles.label}>Email:</Text>
                            <Text style={styles.value}>{firebaseUser.email || 'N/A'}</Text>

                            <Text style={styles.label}>Display Name:</Text>
                            <Text style={styles.value}>{firebaseUser.displayName || 'N/A'}</Text>

                            <Text style={styles.label}>Email Verified:</Text>
                            <Text style={styles.value}>{firebaseUser.emailVerified ? 'Yes' : 'No'}</Text>

                            <Text style={styles.label}>Created At:</Text>
                            <Text style={styles.value}>{formatDate(firebaseUser.metadata.creationTime)}</Text>

                            <Text style={styles.label}>Last Sign In:</Text>
                            <Text style={styles.value}>{formatDate(firebaseUser.metadata.lastSignInTime)}</Text>

                            <Text style={styles.label}>Photo URL:</Text>
                            <Text style={styles.value}>{firebaseUser.photoURL || 'N/A'}</Text>
                        </View>
                    ) : (
                        <Text style={styles.noData}>No Firebase user found</Text>
                    )}
                </Card.Content>
            </Card>

            <Divider style={styles.divider} />

            {/* Supabase User Info */}
            <Card style={styles.card}>
                <Card.Title title="⚡ Supabase User" subtitle="Database Authentication" />
                <Card.Content>
                    {supabaseUser ? (
                        <View>
                            <Text style={styles.label}>ID:</Text>
                            <Text style={styles.value}>{supabaseUser.id}</Text>

                            <Text style={styles.label}>Email:</Text>
                            <Text style={styles.value}>{supabaseUser.email || 'N/A'}</Text>

                            <Text style={styles.label}>Email Confirmed:</Text>
                            <Text style={styles.value}>{supabaseUser.email_confirmed_at ? 'Yes' : 'No'}</Text>

                            <Text style={styles.label}>Created At:</Text>
                            <Text style={styles.value}>{formatDate(supabaseUser.created_at)}</Text>

                            <Text style={styles.label}>Last Sign In:</Text>
                            <Text style={styles.value}>{formatDate(supabaseUser.last_sign_in_at)}</Text>

                            <Text style={styles.label}>User Metadata:</Text>
                            <Text style={[styles.value, styles.codeText]}>
                                {formatObject(supabaseUser.user_metadata)}
                            </Text>

                            <Text style={styles.label}>App Metadata:</Text>
                            <Text style={[styles.value, styles.codeText]}>
                                {formatObject(supabaseUser.app_metadata)}
                            </Text>
                        </View>
                    ) : (
                        <Text style={styles.noData}>
                            {firebaseUser ? 'Supabase authentication pending...' : 'No Supabase user found'}
                        </Text>
                    )}
                </Card.Content>
            </Card>

            {/* Authentication Status */}
            <Card style={styles.card}>
                <Card.Title title="🔐 Authentication Status" />
                <Card.Content>
                    <View style={styles.statusContainer}>
                        <Text style={styles.statusLabel}>Firebase:</Text>
                        <Text style={[styles.statusValue, firebaseUser ? styles.success : styles.failure]}>
                            {firebaseUser ? '✅ Authenticated' : '❌ Not Authenticated'}
                        </Text>
                    </View>

                    <View style={styles.statusContainer}>
                        <Text style={styles.statusLabel}>Supabase:</Text>
                        <Text style={[styles.statusValue, supabaseUser ? styles.success : styles.failure]}>
                            {supabaseUser ? '✅ Authenticated' : '❌ Not Authenticated'}
                        </Text>
                    </View>

                    <View style={styles.statusContainer}>
                        <Text style={styles.statusLabel}>Overall:</Text>
                        <Text style={[styles.statusValue, (firebaseUser && supabaseUser) ? styles.success : styles.failure]}>
                            {(firebaseUser && supabaseUser) ? '✅ Fully Authenticated' : '⚠️ Partial Authentication'}
                        </Text>
                    </View>
                </Card.Content>
            </Card>

            {/* Sign Out Button */}
            {firebaseUser && (
                <Button
                    mode="contained"
                    onPress={handleSignOut}
                    style={styles.signOutButton}
                    icon="logout"
                >
                    Sign Out
                </Button>
            )}
        </ScrollView>
    )
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f5f5f5',
    },
    contentContainer: {
        padding: 16,
        paddingBottom: 32,
    },
    title: {
        fontSize: 28,
        fontWeight: 'bold',
        textAlign: 'center',
        marginBottom: 24,
        color: '#333',
    },
    loadingText: {
        textAlign: 'center',
        marginTop: 16,
        fontSize: 16,
        color: '#666',
    },
    card: {
        marginBottom: 16,
        elevation: 2,
    },
    errorCard: {
        backgroundColor: '#ffebee',
    },
    errorText: {
        fontWeight: 'bold',
        color: '#c62828',
        marginBottom: 8,
    },
    errorMessage: {
        color: '#d32f2f',
    },
    divider: {
        marginVertical: 16,
    },
    label: {
        fontWeight: 'bold',
        marginTop: 8,
        marginBottom: 4,
        color: '#555',
    },
    value: {
        marginBottom: 8,
        color: '#333',
    },
    codeText: {
        fontFamily: 'monospace',
        fontSize: 12,
        backgroundColor: '#f5f5f5',
        padding: 8,
        borderRadius: 4,
    },
    noData: {
        fontStyle: 'italic',
        color: '#666',
        textAlign: 'center',
        padding: 16,
    },
    statusContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 8,
    },
    statusLabel: {
        fontWeight: 'bold',
        color: '#555',
    },
    statusValue: {
        fontWeight: 'bold',
    },
    success: {
        color: '#2e7d32',
    },
    failure: {
        color: '#d32f2f',
    },
    signOutButton: {
        marginTop: 24,
        marginHorizontal: 16,
    },
})