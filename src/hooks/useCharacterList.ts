import { onSnapshot, Unsubscribe, collection } from "firebase/firestore"
import { useEffect, useState } from "react"

import { useUser } from "./useUser"
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

export function useCharacterList(): Character[] {
  const [characterList, setCharacterList] = useState<Character[]>([])
  const user = useUser()

  useEffect(() => {
    if (user) {
      const charactersRef = collection(
        firestore,
        `${charactersCollection}/${user.uid}/${userCharactersCollection}`,
      )
      const unsubscribe: Unsubscribe = onSnapshot(charactersRef, (snapshot) => {
        const characters: Character[] = []
        snapshot.forEach((doc) => {
          const data = doc.data()
          characters.push({
            id: doc.id,
            name: data?.name ?? "",
            avatar: data?.avatar ?? "",
            appearance: data?.appearance ?? "",
            traits: data?.traits ?? "",
            emotions: data?.emotions ?? "",
            isCharacterPublic: data?.isCharacterPublic ?? false,
            context: data?.context ?? "",
          })
        })
        setCharacterList(characters)
      })
      return () => unsubscribe()
    } else {
      setCharacterList([])
    }
  }, [user])

  return characterList
}
