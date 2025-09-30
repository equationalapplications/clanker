import { useState } from "react"
import { StyleSheet, ScrollView, View } from "react-native"
import { FAB } from "react-native-paper"

import Button from "../components/Button"
import LoadingIndicator from "../components/LoadingIndicator"
import { useCharacterList } from "../hooks/useCharacterList"
import { CharacterStackScreenProps } from "../navigation/types"
import { createNewCharacter } from "../utilities/createNewCharacter"

interface CharacterButtonProps {
  id: string
  name: string
}

export default function Characters({ navigation }: CharacterStackScreenProps<"Characters">) {
  const characterList = useCharacterList()
  const [loading, setLoading] = useState(false)

  const onPressEditCharacter = ({ id }: { id: string }) => {
    navigation.navigate("EditCharacter", { id })
  }

  const CharacterButton = ({ id, name }: CharacterButtonProps) => (
    <Button onPress={() => onPressEditCharacter({ id })} mode="contained">
      {name}
    </Button>
  )

  const onPressAddCharacter = async () => {
    setLoading(true)
    const newCharacterId = await createNewCharacter()
    setLoading(false)
    navigation.navigate("EditCharacter", { id: newCharacterId })
  }

  return (
    <View style={styles.container}>
      <ScrollView
        style={{ marginTop: 30, width: "100%" }}
        contentContainerStyle={styles.scrollContentContainer}
      >
        {characterList.map((character) => (
          <CharacterButton
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
})
