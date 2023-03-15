import Constants from "expo-constants"
import { doc, onSnapshot, DocumentReference, Unsubscribe } from "firebase/firestore"
import { useEffect, useState } from "react"

import { firestore } from "../config/firebaseConfig"
import useUser from "./useUser"

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

const charactersCollection = Constants.expoConfig.extra.charactersCollection
const userCharactersCollection = Constants.expoConfig.extra.userCharactersCollection

export default function useDefaultCharacter() {
    const user = useUser()
    let defaultCharacterRef: DocumentReference | null = null

    if (user) {
        defaultCharacterRef = doc(firestore, charactersCollection, user.uid, userCharactersCollection, user.defaultCharacter)
    }

    const [character, setCharacter] = useState<Character | null>(null)

    useEffect(() => {
        let unsubscribeCharacter: Unsubscribe | null = null
        if (defaultCharacterRef) {
            unsubscribeCharacter = onSnapshot(defaultCharacterRef, (doc) => {
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
        }
        return () => {
            if (unsubscribeCharacter) unsubscribeCharacter()
        }
    }, [defaultCharacterRef])
    return character
}
