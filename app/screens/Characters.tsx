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
import { TextInput } from "react-native-paper"

import { Text, View } from "../components/Themed"
import { firestore, auth, functions } from "../config/firebaseConfig"

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
  console.log(defaultCharacter.data)
  const nameValue = defaultCharacter.data?.name ?? ""
  const traitsValue = defaultCharacter.data?.traits ?? ""
  const emotionsValue = defaultCharacter.data?.emotions ?? ""
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

  const onChangeTextTraits = (text) => {
    defaultCharacterMutation.mutate({ traits: text })
  }

  const onChangeTextEmotions = (text) => {
    defaultCharacterMutation.mutate({ emotions: text })
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Characters</Text>
      <View style={styles.separator} lightColor="#eee" darkColor="rgba(255,255,255,0.1)" />
      <TextInput label="Name" value={nameValue} onChangeText={onChangeTextName} />
      <TextInput label="Traits" value={traitsValue} onChangeText={onChangeTextTraits} />
      <TextInput label="Emotions" value={emotionsValue} onChangeText={onChangeTextEmotions} />
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
