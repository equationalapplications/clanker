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

const characterCollection = Constants.expoConfig.extra.characterCollection

export default function useDefaultCharacter() {
    const user = useUser()
    let defaultCharacterRef: DocumentReference | null = null

    if (user) {
        defaultCharacterRef = doc(firestore, characterCollection, user.uid)
    }

    const [character, setCharacter] = useState<Character | null>(null)

    useEffect(() => {
        let unsubscribeCharacer: Unsubscribe | null = (null)
        if (defaultCharacterRef) {
            unsubscribeCharacer = onSnapshot(defaultCharacterRef, (doc) => {
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
        return unsubscribeCharacer ? () => { unsubscribeCharacer() } : null
    }, [defaultCharacterRef])
    return character
}
