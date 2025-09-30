import { doc, onSnapshot, DocumentReference, Unsubscribe } from "firebase/firestore"
import { useEffect, useState, useRef } from "react"

import { charactersCollection, userCharactersCollection } from "../config/constants"
import { firestore } from "../config/firebaseConfig"

interface UseCharacterArgs {
  id: string
  userId: string
}

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

export function useCharacter({ id, userId }: UseCharacterArgs) {
  const [character, setCharacter] = useState<Character | null>(null)
  const characterRef = useRef<DocumentReference>()
  const unsubscribe = useRef<Unsubscribe>()

  useEffect(() => {
    if (userId && id) {
      characterRef.current = doc(
        firestore,
        charactersCollection,
        userId,
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
  }, [id, userId])

  return character
}
