import { useState } from "react"
import { StyleSheet, ScrollView, View } from "react-native"
import { FAB, Card, Text, Button as PaperButton } from "react-native-paper"
import { router } from "expo-router"

import Button from "../components/Button"
import LoadingIndicator from "../components/LoadingIndicator"
import { useCharacterList } from "../hooks/useCharacterList"
import { createNewCharacter } from "../utilities/createNewCharacter"

interface CharacterCardProps {
  id: string
  name: string
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

  const CharacterCard = ({ id, name }: CharacterCardProps) => (
    <Card style={styles.characterCard}>
      <Card.Content>
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
  characterName: {
    textAlign: "center",
    marginBottom: 8,
  },
  cardButton: {
    marginHorizontal: 4,
  },
})