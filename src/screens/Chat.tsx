import { useCallback, useEffect } from "react"
import { StyleSheet, View } from "react-native"
import { GiftedChat, User, IMessage, Bubble } from "react-native-gifted-chat"
import { useTheme, Avatar, Text, ActivityIndicator } from "react-native-paper"
import { useLocalSearchParams, router } from "expo-router"

import { defaultAvatarUrl, height } from "../config/constants"
import { useCharacter } from "../hooks/useCharacter"
import { useAIChat } from "../hooks/useAIChat"
import { useUser } from "../hooks/useUser"
import { useUserPrivate } from "../hooks/useUserPrivate"
import { useIsPremium } from "../hooks/useIsPremium"
import { sendCharacterIntroduction } from "../services/aiChatService"

export default function Chat() {
    const { id } = useLocalSearchParams<{ id: string }>()
    const user = useUser()
    const uid = user?.uid
    const userPrivate = useUserPrivate()
    const credits = userPrivate?.credits ?? 0
    const isPremium = useIsPremium()
    const { colors, roundness } = useTheme()

    // Get character data
    const character = useCharacter({ id: id!, userId: uid! })

    // Convert character to the format expected by aiChatService
    const aiCharacter = character ? {
        id: character.id,
        name: character.name,
        appearance: character.avatar,
        traits: character.traits,
        emotions: character.emotions,
        context: character.context || character.appearance,
    } : null

    // Use AI chat hook
    const { messages, sendMessage, isGeneratingResponse, error } = useAIChat({
        characterId: id!,
        recipientUserId: uid!, // In this case, the character is the "recipient"
        character: aiCharacter!,
    })

    // Send character introduction if no messages exist
    useEffect(() => {
        if (character && messages.length === 0 && uid) {
            sendCharacterIntroduction(aiCharacter!, uid).catch(console.error)
        }
    }, [character, messages.length, uid, aiCharacter])

    const characterAvatar = character?.avatar ?? defaultAvatarUrl
    const characterName = character?.name ?? "Character"
    const isCharacterPublic = character?.isCharacterPublic ?? false

    const chatUser: User = {
        _id: uid!,
        name: user?.displayName ?? "You",
        avatar: user?.photoURL ?? defaultAvatarUrl,
    }

    const onSend = useCallback(async (newMessages: IMessage[]) => {
        if (!isPremium && credits <= 0) {
            router.push("../subscribe")
            return
        }

        if (!newMessages.length || !aiCharacter) return

        try {
            await sendMessage(newMessages[0])
        } catch (err) {
            console.error("Error sending message:", err)
        }
    }, [sendMessage, credits, isPremium, aiCharacter])

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

    const renderChatFooter = useCallback(() => {
        if (isGeneratingResponse) {
            return (
                <View style={styles.typingContainer}>
                    <ActivityIndicator size="small" />
                    <Text style={styles.typingText}>{characterName} is thinking...</Text>
                </View>
            )
        }
        return null
    }, [isGeneratingResponse, characterName])

    if (!character || !aiCharacter) {
        return (
            <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" />
                <Text>Loading character...</Text>
            </View>
        )
    }

    if (error) {
        return (
            <View style={styles.errorContainer}>
                <Text style={styles.errorText}>Error: {error}</Text>
            </View>
        )
    }

    return (
        <View style={styles.container}>
            {isCharacterPublic ? (
                <>
                    <View style={styles.avatarView}>
                        <Avatar.Image size={height * 0.1} source={{ uri: characterAvatar }} />
                        <Text variant="titleLarge" style={styles.titleText}>{characterName}</Text>
                    </View>
                    <GiftedChat
                        showUserAvatar
                        inverted
                        messages={messages}
                        onSend={onSend}
                        user={chatUser}
                        placeholder={`Chat with ${characterName}...`}
                        renderUsernameOnMessage
                        renderBubble={renderBubble}
                        renderChatFooter={renderChatFooter}
                        keyboardShouldPersistTaps="never"
                        alwaysShowSend
                    />
                </>
            ) : (
                <View style={styles.avatarView}>
                    <Text variant="titleLarge">This character is set to private.</Text>
                </View>
            )}
        </View>
    )
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    loadingContainer: {
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
    },
    errorContainer: {
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
        padding: 20,
    },
    errorText: {
        textAlign: "center",
    },
    avatarView: {
        backgroundColor: "rgba(0,0,0,0.05)",
        paddingVertical: 10,
        alignItems: "center",
        justifyContent: "center",
    },
    titleText: {
        marginTop: 8,
        fontWeight: "bold",
    },
    typingContainer: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        paddingVertical: 10,
        paddingHorizontal: 15,
    },
    typingText: {
        marginLeft: 8,
        fontStyle: "italic",
    },
})