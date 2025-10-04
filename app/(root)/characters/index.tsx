import { useState } from "react"
import { StyleSheet, ScrollView, View } from "react-native"
import { FAB, Text } from "react-native-paper"
import { router } from "expo-router"

import Button from "../../../src/components/Button"
import LoadingIndicator from "../../../src/components/LoadingIndicator"
import { useCharacterList } from "../../../src/hooks/useCharacterList"
import { createNewCharacter } from "../../../src/utilities/createNewCharacter"
import { useAuth } from "../../../src/hooks/useAuth"

interface CharacterButtonProps {
    id: string
    name: string
}

export default function Characters() {
    const characterList = useCharacterList()
    const { user, isLoading } = useAuth()
    const [loading, setLoading] = useState(false)

    const onPressEditCharacter = ({ id }: { id: string }) => {
        console.log('Navigating to edit character:', id)
        router.push(`/characters/edit/${id}`)
    }

    const CharacterButton = ({ id, name }: CharacterButtonProps) => {
        console.log('🔘 CharacterButton rendering:', { id, name })
        return (
            <View style={styles.characterCard}>
                <View style={styles.characterInfo}>
                    <View style={styles.avatarContainer}>
                        <Text style={styles.avatarText}>
                            {name.charAt(0).toUpperCase()}
                        </Text>
                    </View>
                    <View style={styles.characterDetails}>
                        <Text style={styles.characterName}>{name}</Text>
                        <Text style={styles.characterSubtitle}>
                            Ready to chat
                        </Text>
                    </View>
                </View>
                <View style={styles.buttonContainer}>
                    <Button
                        mode="outlined"
                        onPress={() => {
                            console.log('🔘 Chat button pressed:', id, name)
                            router.push(`/characters/chat/${id}`)
                        }}
                        style={styles.chatButton}
                        labelStyle={styles.buttonLabel}
                    >
                        Chat
                    </Button>
                    <Button
                        mode="text"
                        onPress={() => {
                            console.log('🔘 Edit button pressed:', id, name)
                            onPressEditCharacter({ id })
                        }}
                        style={styles.editButton}
                        labelStyle={styles.buttonLabel}
                    >
                        Edit
                    </Button>
                </View>
            </View>
        )
    }

    const onPressAddCharacter = async () => {
        console.log('✅ Auth ready, starting character creation...')
        setLoading(true)
        try {
            console.log('🔄 Calling createNewCharacter...')
            const result = await createNewCharacter()
            console.log('✅ Character creation result:', result)
            setLoading(false)
            // Handle both old format (direct ID) and new format (object with id)
            const characterId = typeof result === 'string' ? result : result.id
            console.log('🔗 Navigating to edit with ID:', characterId)
            router.push(`/characters/edit/${characterId}`)
        } catch (error) {
            console.error('❌ Error creating character:', error)
            setLoading(false)
        }
    }

    return (
        <View style={styles.container}>
            <ScrollView
                style={{ marginTop: 30, width: "100%" }}
                contentContainerStyle={styles.scrollContentContainer}
            >
                {(() => {
                    console.log('🎨 Rendering decision - characterList.length:', characterList.length)
                    console.log('🎨 Characters data:', characterList)

                    if (characterList.length === 0) {
                        console.log('🎨 Showing empty state')
                        return (
                            <View style={styles.emptyState}>
                                <Text variant="headlineSmall" style={styles.emptyTitle}>
                                    No Characters Yet
                                </Text>
                                <Text variant="bodyMedium" style={styles.emptyDescription}>
                                    Create your first AI character by tapping the + button below
                                </Text>
                            </View>
                        )
                    } else {
                        console.log('🎨 Showing character list')
                        return characterList.map((character) => {
                            console.log('🎨 Rendering character:', character.id, character.name)
                            return (
                                <CharacterButton
                                    key={character.id}
                                    id={character.id}
                                    name={character.name || "Unnamed Character"}
                                />
                            )
                        })
                    }
                })()}
                <LoadingIndicator disabled={!loading} />
            </ScrollView>
            <FAB
                icon="plus"
                onPress={onPressAddCharacter}
                disabled={loading}
                style={{
                    opacity: (loading) ? 0.5 : 1
                }}
            />
        </View>
    )
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        marginBottom: 30,
    },
    title: {
        fontSize: 20,
        fontWeight: "bold",
    },
    separator: {
        marginVertical: 30,
        height: 1,
        width: "80%",
    },
    textInput: {
        width: "80%",
    },
    scrollContentContainer: {
        alignItems: "center",
    },
    emptyState: {
        alignItems: "center",
        justifyContent: "center",
        marginTop: 100,
        paddingHorizontal: 40,
    },
    emptyTitle: {
        textAlign: "center",
        marginBottom: 16,
    },
    emptyDescription: {
        textAlign: "center",
        opacity: 0.7,
    },
    characterCard: {
        backgroundColor: '#ffffff',
        marginHorizontal: 16,
        marginVertical: 8,
        borderRadius: 12,
        padding: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
        borderWidth: 1,
        borderColor: '#e0e0e0',
    },
    characterInfo: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 12,
    },
    avatarContainer: {
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: '#6200ea',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
    },
    avatarText: {
        color: 'white',
        fontSize: 18,
        fontWeight: 'bold',
    },
    characterDetails: {
        flex: 1,
    },
    characterName: {
        fontSize: 18,
        fontWeight: '600',
        color: '#1a1a1a',
        marginBottom: 2,
    },
    characterSubtitle: {
        fontSize: 14,
        color: '#666666',
    },
    buttonContainer: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        gap: 8,
    },
    chatButton: {
        minWidth: 80,
    },
    editButton: {
        minWidth: 60,
    },
    buttonLabel: {
        fontSize: 14,
        fontWeight: '500',
    },
})