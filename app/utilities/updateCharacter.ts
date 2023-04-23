import { doc, updateDoc, DocumentReference } from "firebase/firestore"

import { charactersCollection, userCharactersCollection } from "../config/constants"
import { firestore, auth } from "../config/firebaseConfig"

let defaultCharacterRef: DocumentReference | null = null

interface UpdateCharacterArgs {
  characterId: string
  name?: string
  avatar?: string
  appearance?: string
  traits?: string
  emotions?: string
  isCharacterPublic?: boolean
  context?: string
}

export default async function updateCharacter({
  characterId,
  ...data
}: UpdateCharacterArgs): Promise<void> {
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
