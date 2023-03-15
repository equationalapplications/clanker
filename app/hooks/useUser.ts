import Constants from "expo-constants"
import { doc, onSnapshot, Unsubscribe } from "firebase/firestore"
import { useEffect, useState } from "react"

import { auth, firestore } from "../config/firebaseConfig"

const usersPublicCollection = Constants.expoConfig.extra.usersPublicCollection
const usersPrivateCollection = Constants.expoConfig.extra.usersPrivateCollection

interface User {
  uid: string
  name: string | null
  avatar: string | null
  email: string | null
  credits: number | null
  isProfilePublic: boolean | null
  isPremium: boolean | null
  defaultCharacter: string | null
}

export default function useUser(): User | null {
  const [user, setUser] = useState<User | null>(null)

  useEffect(() => {
    const unsubscribeAuth = auth.onAuthStateChanged((firebaseUser) => {
      if (firebaseUser) {
        const uid = firebaseUser.uid
        const userPublicRef = doc(firestore, usersPublicCollection, uid)
        const userPrivateRef = doc(firestore, usersPrivateCollection, uid)

        // Subscribe to user public and private firestore data
        let unsubscribePublic: Unsubscribe | null = null
        let unsubscribePrivate: Unsubscribe | null = null

        const handleSnapshot = () => {
          const newUser: User = {
            uid,
            name: firebaseUser.displayName || null,
            avatar: firebaseUser.photoURL || null,
            email: firebaseUser.email || null,
            credits: null,
            isProfilePublic: null,
            isPremium: null,
            defaultCharacter: null,
          }

          // Get user public data
          unsubscribePublic = onSnapshot(userPublicRef, (doc) => {
            if (doc.exists()) {
              const data = doc.data()
              if (data) {
                newUser.name = data.name || newUser.name
                newUser.avatar = data.avatar || newUser.avatar
              }
            }
            setUser(newUser)
          })

          // Get user private data
          unsubscribePrivate = onSnapshot(userPrivateRef, (doc) => {
            if (doc.exists()) {
              const data = doc.data()
              if (data) {
                newUser.credits = data.credits || newUser.credits
                newUser.isProfilePublic = data.isProfilePublic || newUser.isProfilePublic
                newUser.isPremium = data.isPremium || newUser.isPremium
                newUser.defaultCharacter = data.defaultCharacter || newUser.defaultCharacter
              }
            }
            setUser(newUser)
          })
        }

        handleSnapshot()

        return () => {
          unsubscribeAuth()
          if (unsubscribePublic) unsubscribePublic()
          if (unsubscribePrivate) unsubscribePrivate()
        }
      } else {
        setUser(null)
      }
    })
  }, [])

  return user
}
