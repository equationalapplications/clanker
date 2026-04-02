import { View, StyleSheet, FlatList } from 'react-native'
import { Text, Button, ActivityIndicator } from 'react-native-paper'
import { router } from 'expo-router'
import { useCharacters, useCreateCharacter } from '~/hooks/useCharacters'
import { CharacterCard } from '~/components/CharacterCard'
import { useEnsureDefaultCharacter } from '~/hooks/useEnsureDefaultCharacter'

export default function CharactersListScreen() {
    const { characters, isLoading } = useCharacters()
    const createCharacterMutation = useCreateCharacter()
    const { isCreatingDefault } = useEnsureDefaultCharacter()

    const handleCreateCharacter = () => {
        createCharacterMutation.mutate(
            {
                name: 'New Character',
                is_public: false,
            },
            {
                onSuccess: (data) => {
                    if (data) {
                        router.push(`/characters/${data.id}/edit`)
                    }
                },
            },
        )
    }

    if (isLoading) {
        return (
            <View style={styles.centered}>
                <ActivityIndicator size="large" />
                <Text style={styles.loadingText}>Loading characters...</Text>
            </View>
        )
    }

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <Text variant="headlineMedium" style={styles.title}>
                    Characters
                </Text>
                <Button
                    mode="contained"
                    icon="plus"
                    onPress={handleCreateCharacter}
                    loading={createCharacterMutation.isPending}
                    disabled={createCharacterMutation.isPending}
                >
                    New
                </Button>
            </View>

            {!characters || characters.length === 0 ? (
                <View style={styles.centered}>
                    {isCreatingDefault ? (
                        <>
                            <Text variant="bodyLarge" style={styles.emptyText}>
                                Creating your first character...
                            </Text>
                            <ActivityIndicator size="small" style={styles.emptySpinner} />
                        </>
                    ) : (
                        <Text variant="bodyLarge" style={styles.emptyText}>
                            No characters yet. Tap "New" to create one!
                        </Text>
                    )}
                </View>
            ) : (
                <FlatList
                    data={characters}
                    keyExtractor={(item) => item.id}
                    renderItem={({ item }) => (
                        <CharacterCard
                            id={item.id}
                            name={item.name}
                            appearance={item.appearance ?? undefined}
                            avatar={item.avatar ?? undefined}
                            onPress={() => router.push(`/characters/${item.id}`)}
                            onEdit={() => router.push(`/characters/${item.id}/edit`)}
                        />
                    )}
                    contentContainerStyle={styles.list}
                />
            )}
        </View>
    )
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    title: {
        fontWeight: 'bold',
    },
    list: {
        paddingBottom: 16,
    },
    centered: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
    },
    loadingText: {
        marginTop: 12,
        opacity: 0.7,
    },
    emptyText: {
        opacity: 0.7,
        textAlign: 'center',
    },
    emptySpinner: {
        marginTop: 12,
    },
})
