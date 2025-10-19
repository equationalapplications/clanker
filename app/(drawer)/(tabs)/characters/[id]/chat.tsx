import { useLocalSearchParams, router } from 'expo-router'
import { View, StyleSheet, KeyboardAvoidingView, Platform, Dimensions } from 'react-native'
import { GiftedChat, IMessage, User, Bubble } from 'react-native-gifted-chat'
import { useCallback } from 'react'
import { useCharacter } from '~/hooks/useCharacters'
import { useChatMessages } from '~/hooks/useChatMessages'
import { useAIChat } from '~/hooks/useAIChat'
import { Text, useTheme, Avatar } from 'react-native-paper'
import { useAuth } from '~/auth/useAuth'
import { useUserCredits } from '~/hooks/useUserCredits'

const { height } = Dimensions.get('window')
const defaultAvatarUrl = 'https://via.placeholder.com/150'

export default function ChatScreen() {
    const { id } = useLocalSearchParams<{ id: string }>()
    const { user } = useAuth()
    const currentUserId = user?.uid
    const { data: character, isLoading: characterLoading } = useCharacter(id || '')
    const messages = useChatMessages({ id: id || '', userId: currentUserId || '' })
    const { data: creditsData } = useUserCredits()
    const credits = creditsData?.totalCredits || 0
    const hasUnlimited = creditsData?.hasUnlimited || false
    const { colors, roundness } = useTheme()

    const { sendMessage } = useAIChat({
        characterId: id || '',
        userId: currentUserId || '',
        character: character as any, // Type compatibility - character structure matches
    })

    const chatUser: User = {
        _id: currentUserId || '',
        name: user?.displayName || '',
        avatar: user?.photoURL || defaultAvatarUrl,
    }

    const handleSend = useCallback(
        async (newMessages: IMessage[] = []) => {
            if (!currentUserId || !character) return

            // Check credits before sending (unless user has unlimited)
            if (credits <= 0 && !hasUnlimited) {
                router.push('/subscribe')
                return
            }

            if (newMessages.length > 0) {
                const message = newMessages[0]
                await sendMessage(message)
            }
        },
        [sendMessage, currentUserId, character, credits, hasUnlimited],
    )

    const renderBubble = useCallback(
        (props: any) => {
            return (
                <Bubble
                    {...props}
                    wrapperStyle={{
                        left: { backgroundColor: colors.secondary, borderRadius: roundness },
                        right: { backgroundColor: colors.primary, borderRadius: roundness },
                    }}
                    textStyle={{
                        left: { color: colors.onSecondary },
                        right: { color: colors.onPrimary },
                    }}
                />
            )
        },
        [colors, roundness],
    )

    if (characterLoading || !character) {
        return (
            <View style={styles.loadingContainer}>
                <Text>Loading character...</Text>
            </View>
        )
    }

    if (!currentUserId) {
        return (
            <View style={styles.loadingContainer}>
                <Text>Please sign in to chat</Text>
            </View>
        )
    }

    const characterAvatar = character.avatar || defaultAvatarUrl
    const characterName = character.name || 'Character'

    // Note: Privacy check removed - all local characters are owned by the user
    // Privacy will be relevant later when implementing cloud sync and sharing features

    return (
        <View style={styles.container}>
            {/* Character Avatar Header */}
            <View style={styles.avatarView}>
                <Avatar.Image size={height * 0.1} source={{ uri: characterAvatar }} />
                <Text variant="titleLarge" style={styles.titleText}>
                    {characterName}
                </Text>
            </View>

            {/* Chat Interface */}
            <KeyboardAvoidingView
                style={styles.chatContainer}
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                keyboardVerticalOffset={100}
            >
                <GiftedChat
                    showUserAvatar
                    inverted
                    messages={messages}
                    onSend={handleSend}
                    user={chatUser}
                    placeholder="chat with me..."
                    renderUsernameOnMessage
                    renderBubble={renderBubble}
                    alwaysShowSend
                />
            </KeyboardAvoidingView>
        </View>
    )
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    avatarView: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 20,
    },
    titleText: {
        marginTop: 10,
    },
    chatContainer: {
        flex: 1,
    },
})
