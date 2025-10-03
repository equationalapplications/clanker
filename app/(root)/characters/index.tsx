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
    const { user, supabaseUser, isLoading } = useAuth()
    const [loading, setLoading] = useState(false)

    // Debug: Log character list and auth state
    console.log('👥 Characters page - loaded:', characterList.length, characterList)
    console.log('🔐 Auth state - Firebase user:', !!user, 'Supabase user:', !!supabaseUser, 'isLoading:', isLoading)

    // Check if both auth systems are ready
    const isFullyAuthenticated = !!(user && supabaseUser && !isLoading)

    const onPressEditCharacter = ({ id }: { id: string }) => {
        console.log('Navigating to edit character:', id)
        router.push(`/characters/edit/${id}`)
    }

    const CharacterButton = ({ id, name }: CharacterButtonProps) => (
        <Button onPress={() => onPressEditCharacter({ id })} mode="contained">
            {name}
        </Button>
    )

    const onPressAddCharacter = async () => {
        console.log('🆕 Character creation attempted - auth check...')

        if (!isFullyAuthenticated) {
            console.log('❌ Cannot create character - auth not ready:', {
                firebaseUser: !!user,
                supabaseUser: !!supabaseUser,
                isLoading
            })
            // Could show a toast/alert here
            return
        }

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
                {characterList.length === 0 ? (
                    <View style={styles.emptyState}>
                        <Text variant="headlineSmall" style={styles.emptyTitle}>
                            No Characters Yet
                        </Text>
                        <Text variant="bodyMedium" style={styles.emptyDescription}>
                            Create your first AI character by tapping the + button below
                        </Text>
                    </View>
                ) : (
                    characterList.map((character) => (
                        <CharacterButton
                            key={character.id}
                            id={character.id}
                            name={character.name || "Unnamed Character"}
                        />
                    ))
                )}
                <LoadingIndicator disabled={!loading} />
            </ScrollView>
            <FAB
                icon="plus"
                onPress={onPressAddCharacter}
                disabled={!isFullyAuthenticated || loading}
                style={{
                    opacity: (!isFullyAuthenticated || loading) ? 0.5 : 1
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
})