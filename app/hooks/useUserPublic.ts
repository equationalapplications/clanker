import { doc, onSnapshot } from "firebase/firestore"
import { useEffect, useState } from "react"

import { usersPublicCollection } from "../config/constants"
import { auth, firestore } from "../config/firebaseConfig"

interface UserPublic {
  uid: string
  name: string
  avatar: string
  email: string
}

export default function useUserPublic(): UserPublic | null {
  const [userPublic, setUserPublic] = useState<UserPublic | null>(null)

  useEffect(() => {
    const user = auth.currentUser

    if (user) {
      const userPublicRef = doc(firestore, `${usersPublicCollection}/${user.uid}`)
      const unsubscribePublic = onSnapshot(userPublicRef, (doc) => {
        if (doc.exists()) {
          const data = doc.data() as UserPublic
          setUserPublic(data)
        }
      })

      return () => unsubscribePublic()
    } else {
      setUserPublic(null)
    }
  }, [])

  return userPublic
}
