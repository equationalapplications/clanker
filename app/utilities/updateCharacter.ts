import Constants from "expo-constants"
import { doc, updateDoc, DocumentReference } from "firebase/firestore"

import { firestore, auth } from "../config/firebaseConfig"

const charactersCollection = Constants.expoConfig.extra.charactersCollection
const userCharactersCollection = Constants.expoConfig.extra.userCharactersCollection

let defaultCharacterRef: DocumentReference | null = null

export default async function updateCharacter(
  characterId: string,
  data: Partial<{
    name: string
    avatar: string
    appearance: string
    traits: string
    emotions: string
    isCharacterPublic: boolean
    context: string
  }>,
) {
  if (auth.currentUser) {
    const uid = auth.currentUser.uid
    defaultCharacterRef = doc(
      firestore,
      charactersCollection,
      uid,
      userCharactersCollection,
      characterId,
    )
    try {
      await updateDoc(defaultCharacterRef, data)
    } catch (error) {
      console.error("Error updating default character:", error)
    }
  }
}
