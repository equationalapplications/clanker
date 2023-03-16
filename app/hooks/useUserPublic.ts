import Constants from "expo-constants"
import { doc, onSnapshot, Unsubscribe } from "firebase/firestore"
import { useEffect, useState } from "react"

import { auth, firestore } from "../config/firebaseConfig"

const usersPublicCollection = Constants.expoConfig.extra.usersPublicCollection
const usersPrivateCollection = Constants.expoConfig.extra.usersPrivateCollection

interface UserPublic {
    uid: string
    name: string
    avatar: string
    email: string
}

export default function useUserPublic(): UserPublic | null {
    const [userPublic, setUserPublic] = useState<UserPublic | null>(null)

    useEffect(() => {
        const unsubscribeAuth = auth.onAuthStateChanged((firebaseUser) => {
            if (firebaseUser) {
                const uid = firebaseUser.uid
                const userPublicRef = doc(firestore, usersPublicCollection, uid)
                const userPrivateRef = doc(firestore, usersPrivateCollection, uid)

                // Subscribe to user public and private firestore data
                let unsubscribePublic: Unsubscribe | null = null
                let unsubscribePrivate: Unsubscribe | null = null

                // Get user public data
                unsubscribePublic = onSnapshot(userPublicRef, (doc) => {
                    if (doc.exists()) {
                        const data = doc.data()
                        if (data) {
                            setUserPublic({
                                uid,
                                name: data.name,
                                avatar: data.avatar,
                                email: data.email,
                            })
                        }
                    }
                })

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
                return unsubscribePublic()
            } else {
                return null
            }
        })
    }, [])
    return userPublic
}
