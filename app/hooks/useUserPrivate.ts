import Constants from "expo-constants"
import { doc, onSnapshot, Unsubscribe } from "firebase/firestore"
import { useEffect, useState } from "react"

import { auth, firestore } from "../config/firebaseConfig"

const usersPublicCollection = Constants.expoConfig.extra.usersPublicCollection
const usersPrivateCollection = Constants.expoConfig.extra.usersPrivateCollection


interface UserPrivate {
    credits: number
    isProfilePublic: boolean | null
    isPremium: boolean | null
    defaultCharacter: string
}


export default function useUserPrivate(): UserPrivate | null {
    const [userPrivate, setUserPrivate] = useState<UserPrivate | null>(null)

    useEffect(() => {
        // Get user private data
        unsubscribePrivate = onSnapshot(userPrivateRef, (doc) => {
            if (doc.exists()) {
                const data = doc.data()
                if (data) {
                    setUserPrivate({
                        credits: data.credits,
                        isProfilePublic: data.isProfilePublic,
                        isPremium: data.isPremium,
                        defaultCharacter: data.defaultCharacter,
                    })
                }
            }
        })
        return unsubscribePrivate()
    } else {
        return null
    }
        })
}, [])
return userPrivate
}
