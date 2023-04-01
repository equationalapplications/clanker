import { doc, onSnapshot, Unsubscribe } from "firebase/firestore"
import { useEffect, useState } from "react"

import { usersPrivateCollection } from "../config/constants"
import { auth, firestore } from "../config/firebaseConfig"

interface UserPrivate {
  credits: number
  isProfilePublic: boolean | null
  defaultCharacter: string
  hasAcceptedTermsDate: Date | null
}

export default function useUserPrivate(): UserPrivate | null {
  const [userPrivate, setUserPrivate] = useState<UserPrivate | null>(null)

  useEffect(() => {
    const user = auth.currentUser

    if (user) {
      const userPrivateRef = doc(firestore, `${usersPrivateCollection}/${user.uid}`)
      const unsubscribePrivate = onSnapshot(userPrivateRef, (doc) => {
        if (doc.exists()) {
          const data = doc.data() as UserPrivate
          setUserPrivate(data)
        }
      })

      return () => unsubscribePrivate()
    } else {
      setUserPrivate(null)
    }
  }, [])

  return userPrivate
}
