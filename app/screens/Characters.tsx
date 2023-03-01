import { useAuthUser } from "@react-query-firebase/auth"
import {
  useFirestoreTransaction,
  useFirestoreDocumentMutation,
  useFirestoreDocumentData,
  useFirestoreQueryData,
  useFirestoreCollectionMutation,
} from "@react-query-firebase/firestore"
import { collection, doc, addDoc } from "firebase/firestore"
import { StyleSheet } from "react-native"
import { TextInput, Avatar } from "react-native-paper"
import { httpsCallable } from "firebase/functions"

import { Text, View } from "../components/Themed"
import Button from "../components/Button"
import { firestore, auth, functions } from "../config/firebaseConfig"
import { async } from "@firebase/util"

const getImage: any = httpsCallable(functions, "getImage")

export default function Characters() {
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
  const appearance = defaultCharacter.data?.appearance ?? ""
  const name = defaultCharacter.data?.name ?? ""
  const traits = defaultCharacter.data?.traits ?? ""
  const emotions = defaultCharacter.data?.emotions ?? ""
  const defaultCharacterMutation = useFirestoreDocumentMutation(defaultCharacterRef, {
    merge: true,
  })

  //const defaultCharacterRef = doc(charactersRef,)
  //const charactersMutation = useFirestoreCollectionMutation(charactersRef)
  //const charactersQuery = useFirestoreQueryData(["messages"], messagesRef, {
  //  subscribe: true,
  //})

  const onChangeTextName = (text) => {
    defaultCharacterMutation.mutate({ name: text })
  }

  const onChangeTextAppearance = (text) => {
    defaultCharacterMutation.mutate({ appearance: text })
  }

  const onChangeTextTraits = (text) => {
    defaultCharacterMutation.mutate({ traits: text })
  }

  const onChangeTextEmotions = (text) => {
    defaultCharacterMutation.mutate({ emotions: text })
  }

  const onPressGenerate = async () => {
    const promptText = "A profile picture of " + appearance +
      ", who is " + traits +
      ", and is feeling " + emotions + "."
    const { data } = await getImage({
      text: promptText,
      characterId: defaultCharacterId
    })
    console.log("getImage", data.reply)
  }

  return (
    <View style={styles.container}>
      <Avatar.Image size={256} source={avatar} />
      <Button onPress={onPressGenerate}>Generate New Image</Button>
      <View style={styles.separator} />
      <TextInput label="Name" value={name} onChangeText={onChangeTextName} />
      <TextInput label="Appearance" value={appearance} onChangeText={onChangeTextAppearance} />
      <TextInput label="Traits" value={traits} onChangeText={onChangeTextTraits} />
      <TextInput label="Emotions" value={emotions} onChangeText={onChangeTextEmotions} />
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
})
