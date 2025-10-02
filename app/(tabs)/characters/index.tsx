import { useState } from "react"
import { StyleSheet, ScrollView, View } from "react-native"
import { FAB, Card, Text, Button as PaperButton } from "react-native-paper"
import { router } from "expo-router"

import Button from "../../../src/components/Button"
import CharacterAvatar from "../../../src/components/CharacterAvatar"
import LoadingIndicator from "../../../src/components/LoadingIndicator"
import { useCharacterList } from "../../../src/hooks/useCharacterList"
import { createNewCharacter } from "../../../src/utilities/createNewCharacter"

interface CharacterCardProps {
    id: string
    name: string
    avatar?: string | null
}

export default function Characters() {
    const characterList = useCharacterList()
    const [loading, setLoading] = useState(false)

    const onPressEditCharacter = ({ id }: { id: string }) => {
        router.push(`./edit/${id}`)
    }

    const onPressChatCharacter = ({ id }: { id: string }) => {
        router.push(`./chat/${id}`)
    }

    const CharacterCard = ({ id, name, avatar }: CharacterCardProps) => (
        <Card style={styles.characterCard}>
            <Card.Content style={styles.cardContent}>
                <CharacterAvatar
                    size={60}
                    imageUrl={avatar}
                    characterName={name}
                />
                <Text variant="titleMedium" style={styles.characterName}>{name}</Text>
            </Card.Content>
            <Card.Actions>
                <PaperButton
                    mode="outlined"
                    onPress={() => onPressEditCharacter({ id })}
                    style={styles.cardButton}
                >
                    Edit
                </PaperButton>
                <PaperButton
                    mode="contained"
                    onPress={() => onPressChatCharacter({ id })}
                    style={styles.cardButton}
                >
                    Chat
                </PaperButton>
            </Card.Actions>
        </Card>
    )

    const onPressAddCharacter = async () => {
        setLoading(true)
        const newCharacterId = await createNewCharacter()
        setLoading(false)
        router.push(`./edit/${newCharacterId}`)
    }

    return (
        <View style={styles.container}>
            <ScrollView
                style={{ marginTop: 30, width: "100%" }}
                contentContainerStyle={styles.scrollContentContainer}
            >
                {characterList.map((character) => (
                    <CharacterCard
                        key={character.id}
                        id={character.id}
                        name={character.name || "Unnamed Character"}
                        avatar={character.avatar}
                    />
                ))}
                <LoadingIndicator disabled={!loading} />
            </ScrollView>
            <FAB icon="plus" onPress={onPressAddCharacter} />
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
    characterCard: {
        width: "90%",
        marginVertical: 8,
    },
    cardContent: {
        alignItems: "center",
        paddingVertical: 16,
    },
    characterName: {
        textAlign: "center",
        marginTop: 8,
        marginBottom: 8,
    },
    cardButton: {
        marginHorizontal: 4,
    },
})