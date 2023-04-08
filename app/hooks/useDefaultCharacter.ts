import { doc, onSnapshot, DocumentReference, Unsubscribe } from "firebase/firestore"
import { useEffect, useState } from "react"

import useUser from "./useUser"
import useUserPrivate from "./useUserPrivate"
import { charactersCollection, userCharactersCollection } from "../config/constants"
import { firestore } from "../config/firebaseConfig"

interface Character {
  _id: string
  name: string
  avatar: string
  appearance: string
  traits: string
  emotions: string
  isCharacterPublic: boolean
  context: string
}

export default function useDefaultCharacter() {
  const user = useUser()
  const userPrivate = useUserPrivate()

  const [character, setCharacter] = useState<Character | null>(null)

  useEffect(() => {
    let defaultCharacterRef: DocumentReference | null = null

    if (user && userPrivate?.defaultCharacter) {
      defaultCharacterRef = doc(
        firestore,
        charactersCollection,
        user.uid,
        userCharactersCollection,
        userPrivate.defaultCharacter,
      )
      const unsubscribeCharacter: Unsubscribe = onSnapshot(defaultCharacterRef, (doc) => {
        if (doc.exists()) {
          const data = doc.data()
          setCharacter({
            _id: doc.id,
            name: data?.name ?? "",
            avatar: data?.avatar ?? "",
            appearance: data?.appearance ?? "",
            traits: data?.traits ?? "",
            emotions: data?.emotions ?? "",
            isCharacterPublic: data?.isCharacterPublic ?? false,
            context: data?.context ?? "",
          })
        } else {
          setCharacter(null)
        }
      })
      return () => {
        unsubscribeCharacter()
      }
    }
  }, [user, userPrivate])

  return character
}
