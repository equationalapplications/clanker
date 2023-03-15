import Constants from "expo-constants"
import { doc, updateDoc } from "firebase/firestore"

import { firestore, auth } from "../config/firebaseConfig"

const characterCollection = Constants.expoConfig.extra.characterCollection

export default async function updateDefaultCharacter(
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
  /* const uid = auth.currentUser.uid
   const defaultCharacterRef = doc(firestore, characterCollection, uid)
   try {
     await updateDoc(defaultCharacterRef, data)
     console.log("Default character updated successfully.")
   } catch (error) {
     console.error("Error updating default character:", error)
   }*/
}
