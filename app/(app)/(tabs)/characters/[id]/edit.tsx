import { useLocalSearchParams, router } from 'expo-router'
import { View, StyleSheet, ScrollView } from 'react-native'
import { Text, TextInput, Button, Divider } from 'react-native-paper'
import { useState, useEffect } from 'react'
import { useCharacter, useUpdateCharacter } from '~/hooks/useCharacters'
import { useAuth } from '~/auth/useAuth'

export default function EditCharacterScreen() {
    const { id } = useLocalSearchParams<{ id: string }>()
    const { user } = useAuth()
    const { data: character, isLoading } = useCharacter(id || '')
    const updateCharacterMutation = useUpdateCharacter()

    const [name, setName] = useState('')
    const [appearance, setAppearance] = useState('')
    const [traits, setTraits] = useState('')
    const [emotions, setEmotions] = useState('')
    const [context, setContext] = useState('')

    // Update local state when character data loads
    useEffect(() => {
        if (character) {
            setName(character.name || '')
            setAppearance(character.appearance || '')
            setTraits(character.traits || '')
            setEmotions(character.emotions || '')
            setContext(character.context || '')
        }
    }, [character])

    const handleSave = async () => {
        if (!id || !user?.uid) return

        try {
            await updateCharacterMutation.mutateAsync({
                id,
                updates: {
                    name,
                    appearance,
                    traits,
                    emotions,
                    context,
                },
            })
            router.back()
        } catch (error) {
            console.error('Failed to save character:', error)
        }
    }

    if (isLoading) {
        return (
            <View style={styles.container}>
                <Text>Loading character...</Text>
            </View>
        )
    }

    if (!character) {
        return (
            <View style={styles.container}>
                <Text>Character not found</Text>
                <Button mode="contained" onPress={() => router.back()}>
                    Go Back
                </Button>
            </View>
        )
    }

    return (
        <ScrollView style={styles.container}>
            <View style={styles.content}>
                <Text variant="headlineMedium" style={styles.title}>
                    Edit Character
                </Text>

                <TextInput
                    label="Name"
                    value={name}
                    onChangeText={setName}
                    mode="outlined"
                    style={styles.input}
                    maxLength={30}
                />

                <TextInput
                    label="Appearance"
                    value={appearance}
                    onChangeText={setAppearance}
                    mode="outlined"
                    style={styles.input}
                    multiline
                    numberOfLines={3}
                    maxLength={144}
                />

                <TextInput
                    label="Personality Traits"
                    value={traits}
                    onChangeText={setTraits}
                    mode="outlined"
                    style={styles.input}
                    multiline
                    numberOfLines={3}
                    maxLength={144}
                />

                <TextInput
                    label="Emotions"
                    value={emotions}
                    onChangeText={setEmotions}
                    mode="outlined"
                    style={styles.input}
                    multiline
                    numberOfLines={3}
                    maxLength={144}
                />

                <TextInput
                    label="Context"
                    value={context}
                    onChangeText={setContext}
                    mode="outlined"
                    style={styles.input}
                    multiline
                    numberOfLines={4}
                />

                <Divider style={styles.divider} />

                <View style={styles.buttonContainer}>
                    <Button mode="outlined" onPress={() => router.back()} style={styles.button}>
                        Cancel
                    </Button>
                    <Button mode="contained" onPress={handleSave} style={styles.button}>
                        Save Changes
                    </Button>
                </View>
            </View>
        </ScrollView>
    )
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    content: {
        padding: 20,
    },
    title: {
        marginBottom: 24,
    },
    input: {
        marginBottom: 16,
    },
    divider: {
        marginVertical: 20,
    },
    buttonContainer: {
        flexDirection: 'row',
        gap: 12,
        justifyContent: 'space-between',
    },
    button: {
        flex: 1,
    },
})
