import { doc, onSnapshot, DocumentReference, Unsubscribe } from "firebase/firestore"
import { useEffect, useState, useRef } from "react"

import { charactersCollection, userCharactersCollection } from "../config/constants"
import { firestore } from "../config/firebaseConfig"

interface Character {
  id: string
  name: string
  avatar: string
  appearance: string
  traits: string
  emotions: string
  isCharacterPublic: boolean
  context: string
}

export default function useCharacter(userOfCharacter: string, id: string) {
  const [character, setCharacter] = useState<Character | null>(null)
  const characterRef = useRef<DocumentReference>()
  const unsubscribe = useRef<Unsubscribe>()

  useEffect(() => {
    if (userOfCharacter && id) {
      characterRef.current = doc(
        firestore,
        charactersCollection,
        userOfCharacter,
        userCharactersCollection,
        id,
      )
      unsubscribe.current = onSnapshot(characterRef.current, (doc) => {
        if (doc.exists()) {
          const data = doc.data()
          setCharacter({
            id: doc.id,
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
    }
    return () => {
      unsubscribe.current?.()
    }
  }, [id, userOfCharacter])

  return character
}
