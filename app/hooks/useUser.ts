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

interface UserPrivate {
  credits: number
  isProfilePublic: boolean | null
  isPremium: boolean | null
  defaultCharacter: string
}

interface User extends UserPublic, UserPrivate {}

export default function useUser(): User | null {
  const [userPublic, setUserPublic] = useState<UserPublic | null>(null)
  const [userPrivate, setUserPrivate] = useState<UserPrivate | null>(null)

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

        return () => {
          unsubscribeAuth()
          if (unsubscribePublic) unsubscribePublic()
          if (unsubscribePrivate) unsubscribePrivate()
        }
      } else {
        return null
      }
    })
  }, [])

  const user: User = { ...userPublic, ...userPrivate }

  return userPrivate && userPublic ? user : null
}
