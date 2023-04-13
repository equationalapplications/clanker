import { useState, useEffect } from "react"
import { StyleSheet, ScrollView, View } from "react-native"
import { TextInput, Avatar, FAB } from "react-native-paper"

import Button from "../components/Button"
import LoadingIndicator from "../components/LoadingIndicator"
import { defaultAvatarUrl } from "../config/constants"
import useUserPrivate from "../hooks/useUserPrivate"
import { RootTabScreenProps } from "../navigation/types"
import { createNewCharacter } from "../utilities/createNewCharacter"

export default function Characters({ navigation }: RootTabScreenProps<"Characters">) {
  const userPrivate = useUserPrivate()
  const [loading, setLoading] = useState(false)

  const onPressEditCharacter = () => {
    navigation.navigate("EditCharacter", { id: userPrivate.defaultCharacter })
  }

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
        <Button onPress={onPressEditCharacter}>Edit Character</Button>
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
