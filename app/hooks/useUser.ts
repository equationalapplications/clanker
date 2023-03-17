import { User } from "firebase/auth"
import { useEffect, useState } from "react"

import { auth } from "../config/firebaseConfig"

export default function useUser(): User | null {
  const [user, setUser] = useState<User | null>(null)

  useEffect(() => {
    const unsubscribeAuth = auth.onAuthStateChanged((firebaseUser) => {
      if (firebaseUser) {
        setUser(firebaseUser)
      } else {
        setUser(null)
      }
    })

    return () => unsubscribeAuth()
  }, [])

  return user
}
