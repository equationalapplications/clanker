import { useNavigation } from "@react-navigation/native"
import { useAuthUser } from "@react-query-firebase/auth"
import {
  useFirestoreDocumentMutation,
  useFirestoreDocumentData,
} from "@react-query-firebase/firestore"
import { doc } from "firebase/firestore"
import { httpsCallable } from "firebase/functions"
import { useState, useEffect } from "react"
import { StyleSheet, ScrollView, View, ActivityIndicator } from "react-native"
import { TextInput, Avatar } from "react-native-paper"

import Button from "../components/Button"
import { firestore, auth, functions } from "../config/firebaseConfig"

const getImage: any = httpsCallable(functions, "getImage")

export default function Characters() {
  const navigation = useNavigation()
  const [appearance, setAppearance] = useState("")
  const [name, setName] = useState("")
  const [traits, setTraits] = useState("")
  const [emotions, setEmotions] = useState("")
  const [imageIsLoading, setImageIsLoading] = useState(false)

  const user = useAuthUser(["user"], auth)
  const uid = user?.data?.uid ?? ""
  const userPrivateRef = doc(firestore, "users_private", uid)
  const userPrivate = useFirestoreDocumentData(["userPrivate"], userPrivateRef, {
    subscribe: true,
  })
  const defaultCharacterId = userPrivate.data?.defaultCharacter ?? "0"
  const defaultCharacterRef = doc(
    firestore,
    "characters",
    uid,
    "user_characters",
    defaultCharacterId,
  )
  const defaultCharacter = useFirestoreDocumentData(
    ["defaultCharacter", defaultCharacterId],
    defaultCharacterRef,
    {
      subscribe: true,
    },
  )
  const avatar = defaultCharacter.data?.avatar ?? ""

  const defaultCharacterMutation = useFirestoreDocumentMutation(defaultCharacterRef, {
    merge: true,
  })

  const updateCharacter = () => {
    setName(defaultCharacter.data?.name ?? "")
    setAppearance(defaultCharacter.data?.appearance ?? "")
    setTraits(defaultCharacter.data?.traits ?? "")
    setEmotions(defaultCharacter.data?.emotions ?? "")
  }

  useEffect(() => {
    updateCharacter()
  }, [defaultCharacter.data])

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
    defaultCharacterMutation.mutate({
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
    const { data } = await getImage({
      text: promptText,
      characterId: defaultCharacterId,
    })
    console.log("getImage", data.reply)
    setImageIsLoading(false)
  }

  const onPressErase = async () => {
    defaultCharacterMutation.mutate({ context: "" })
  }

  return (
    <View style={styles.container}>
      <ScrollView
        style={{ marginTop: 30, width: "100%" }}
        contentContainerStyle={{ alignItems: "center" }}
      >
        {imageIsLoading ? <ActivityIndicator /> : <Avatar.Image size={256} source={avatar} />}
        <Button mode="outlined" onPress={onPressGenerate}>
          Generate New Image
        </Button>
        <TextInput
          label="Name"
          value={defaultCharacter.data?.name ?? ""}
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
})
