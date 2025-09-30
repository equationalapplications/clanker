import { doc, onSnapshot, Unsubscribe } from "firebase/firestore"
import { useEffect, useState } from "react"

import { useUser } from "./useUser"
import { usersPrivateCollection } from "../config/constants"
import { firestore } from "../config/firebaseConfig"

interface UserPrivate {
  credits: number
  isProfilePublic: boolean | null
  defaultCharacter: string
  hasAcceptedTermsDate: Date | null
}

export function useUserPrivate(): UserPrivate | null {
  const [userPrivate, setUserPrivate] = useState<UserPrivate | null>(null)
  const user = useUser()

  useEffect(() => {
    if (user) {
      const userPrivateRef = doc(firestore, `${usersPrivateCollection}/${user.uid}`)
      const unsubscribePrivate: Unsubscribe = onSnapshot(userPrivateRef, (doc) => {
        if (doc.exists()) {
          const data = doc.data() as UserPrivate
          setUserPrivate(data)
        }
      })
      return () => unsubscribePrivate()
    } else {
      setUserPrivate(null)
    }
  }, [user])

  return userPrivate ?? null
}
