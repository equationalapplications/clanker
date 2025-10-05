import { useState } from 'react'
import { StyleSheet, View, ScrollView } from 'react-native'
import { Text, Avatar, useTheme } from 'react-native-paper'
import { router } from 'expo-router'

import Button from '../../src/components/Button'
import ConfirmationModal from '../../src/components/ConfirmationModal'
import LoadingIndicator from '../../src/components/LoadingIndicator'
import { defaultAvatarUrl } from '../../src/config/constants'
import { useAuth } from '../../src/hooks/useAuth'
import { useUserPublic } from '../../src/hooks/useUserPublic'
import { useUserPrivate } from '../../src/hooks/useUserPrivate'
import { useIsPremium } from '../../src/hooks/useIsPremium'
import { supabaseClient } from '../../src/config/supabaseClient'
import { deleteUser } from '../../src/utilities/deleteUser'

export default function Profile() {
    const { colors } = useTheme()
    const { user } = useAuth()
    const userPublic = useUserPublic()
    const userPrivate = useUserPrivate()
    const isPremium = useIsPremium()

    const displayName = userPublic?.name || user?.email || 'User'
    const email = userPublic?.email || user?.email || ''
    const photoURL = userPublic?.avatar || defaultAvatarUrl
    const credits = userPrivate?.credits ?? 0

    const [isModalVisible, setIsModalVisible] = useState(false)
    const [isDeleting, setIsDeleting] = useState(false)

    const onPressSignOut = async () => {
        await supabaseClient.auth.signOut()
        router.replace('/sign-in')
    }

    const onPressDeleteAccount = () => {
        setIsModalVisible(true)
    }

    const onConfirmDeleteAccount = async () => {
        setIsModalVisible(false)
        setIsDeleting(true)
        try {
            await deleteUser()
            router.replace('/sign-in')
        } catch (error) {
            console.error('Error deleting account:', error)
        } finally {
            setIsDeleting(false)
        }
    }

    const onCancelDeleteAccount = () => {
        setIsModalVisible(false)
    }

    return (
        <ScrollView contentContainerStyle={styles.container}>
            {!isModalVisible && (
                <>
                    <Avatar.Image
                        size={150}
                        source={{ uri: photoURL }}
                        style={styles.avatar}
                    />
                    <Text variant="headlineSmall" style={styles.name}>
                        {displayName}
                    </Text>
                    <Text variant="bodyMedium" style={styles.email}>
                        {email}
                    </Text>

                    <View style={styles.creditsContainer}>
                        <Text variant="titleMedium">Credits: {credits}</Text>
                        <Text variant="bodySmall" style={styles.subscriptionText}>
                            {isPremium
                                ? 'You have a subscription for unlimited credit'
                                : 'You are using free trial credits.'}
                        </Text>
                    </View>

                    <View style={styles.separator} />

                    <View style={styles.buttonContainer}>
                        <Button
                            mode="outlined"
                            onPress={onPressSignOut}
                            style={styles.button}
                        >
                            Sign Out
                        </Button>

                        {isDeleting && <LoadingIndicator />}

                        <Button
                            mode="text"
                            onPress={onPressDeleteAccount}
                            style={styles.button}
                            textColor={colors.error}
                        >
                            Delete Account
                        </Button>
                    </View>
                </>
            )}

            <ConfirmationModal
                visible={isModalVisible}
                title="Delete Account and Data"
                message="Are you sure you want to delete your account? This action is irreversible and will delete all of your data."
                onCancel={onCancelDeleteAccount}
                onConfirm={onConfirmDeleteAccount}
            />
        </ScrollView>
    )
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
    },
    avatar: {
        marginVertical: 20,
    },
    name: {
        marginTop: 10,
        fontWeight: 'bold',
    },
    email: {
        marginTop: 5,
        opacity: 0.7,
    },
    creditsContainer: {
        marginTop: 20,
        alignItems: 'center',
    },
    subscriptionText: {
        marginTop: 5,
        textAlign: 'center',
        opacity: 0.7,
        paddingHorizontal: 20,
    },
    separator: {
        marginVertical: 30,
        height: 1,
        width: '80%',
        backgroundColor: 'rgba(0, 0, 0, 0.1)',
    },
    buttonContainer: {
        width: '100%',
        alignItems: 'center',
    },
    button: {
        marginVertical: 8,
        minWidth: 200,
    },
})
