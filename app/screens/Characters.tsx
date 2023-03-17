import { httpsCallable } from "firebase/functions"
import { useState, useEffect } from "react"
import { StyleSheet, ScrollView, View, ActivityIndicator } from "react-native"
import { TextInput, Avatar } from "react-native-paper"

import Button from "../components/Button"
import { functions } from "../config/firebaseConfig"
import useDefaultCharacter from "../hooks/useDefaultCharacter"
import updateCharacter from "../utilities/updateCharacter"

const getImageFn: any = httpsCallable(functions, "getImage")

export default function Characters({ navigation }) {
  const defaultCharacter = useDefaultCharacter()

  const [avatar, setAvatar] = useState(
    defaultCharacter?.avatar ?? "https://www.gravatar.com/avatar?d=mp",
  )
  const [appearance, setAppearance] = useState(defaultCharacter?.appearance ?? "")
  const [name, setName] = useState(defaultCharacter?.name ?? "")
  const [traits, setTraits] = useState(defaultCharacter?.traits ?? "")
  const [emotions, setEmotions] = useState(defaultCharacter?.emotions ?? "")
  const [imageIsLoading, setImageIsLoading] = useState(false)

  useEffect(() => {
    const updateState = () => {
      setAvatar(defaultCharacter?.avatar ?? "https://www.gravatar.com/avatar?d=mp")
      setName(defaultCharacter?.name ?? "")
      setAppearance(defaultCharacter?.appearance ?? "")
      setTraits(defaultCharacter?.traits ?? "")
      setEmotions(defaultCharacter?.emotions ?? "")
    }
    updateState()

    const unsubscribe = navigation.addListener("focus", updateState)

    return unsubscribe
  }, [navigation, defaultCharacter])

  const onChangeTextName = (text: string) => {
    setName(text)
  }

  const onChangeTextAppearance = (text: string) => {
    setAppearance(text)
  }

  const onChangeTextTraits = (text: string) => {
    setTraits(text)
  }

  const onChangeTextEmotions = (text: string) => {
    setEmotions(text)
  }

  const onPressSave = () => {
    updateCharacter(defaultCharacter._id, {
      name,
      appearance,
      traits,
      emotions,
    })
  }

  const onPressGenerate = async () => {
    setImageIsLoading(true)
    const promptText =
      "A profile picture of " +
      appearance +
      ", who is " +
      traits +
      ", and is feeling " +
      emotions +
      "."
    const { data } = await getImageFn({
      text: promptText,
      characterId: defaultCharacter._id,
    })
    console.log("getImage", data.reply)
    setImageIsLoading(false)
  }

  const onPressErase = async () => {
    updateCharacter(defaultCharacter._id, { context: "" })
  }

  return (
    <View style={styles.container}>
      <ScrollView
        style={{ marginTop: 30, width: "100%" }}
        contentContainerStyle={styles.scrollContentContainer}
      >
        {imageIsLoading ? (
          <ActivityIndicator />
        ) : (
          <Avatar.Image size={256} source={{ uri: avatar }} />
        )}
        <Button mode="outlined" onPress={onPressGenerate} disabled={imageIsLoading}>
          Generate New Image
        </Button>
        <TextInput
          label="Name"
          value={name}
          onChangeText={onChangeTextName}
          style={styles.textInput}
          maxLength={30}
        />
        <TextInput
          label="Appearance"
          value={appearance}
          onChangeText={onChangeTextAppearance}
          style={styles.textInput}
          multiline
          numberOfLines={3}
          maxLength={144}
        />
        <TextInput
          label="Traits"
          value={traits}
          onChangeText={onChangeTextTraits}
          style={styles.textInput}
          multiline
          numberOfLines={3}
          maxLength={144}
        />
        <TextInput
          label="Emotions"
          value={emotions}
          onChangeText={onChangeTextEmotions}
          style={styles.textInput}
          multiline
          numberOfLines={3}
          maxLength={144}
        />
        <Button mode="outlined" onPress={onPressSave}>
          Save Changes
        </Button>
        <Button mode="outlined" onPress={onPressErase}>
          Erase Memory
        </Button>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
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
