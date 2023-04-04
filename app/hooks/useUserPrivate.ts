import { doc, getDoc } from "firebase/firestore"
import { useQuery } from "react-query"

import { usersPrivateCollection } from "../config/constants"
import { auth, firestore } from "../config/firebaseConfig"

interface UserPrivate {
  credits: number
  isProfilePublic: boolean | null
  defaultCharacter: string
  hasAcceptedTermsDate: Date | null
}

export default function useUserPrivate(): UserPrivate | null {
  const user = auth.currentUser
  const userPrivateRef = user ? doc(firestore, `${usersPrivateCollection}/${user.uid}`) : null

  const { data: userPrivate } = useQuery<UserPrivate | null>(
    "userPrivate",
    async () => {
      if (userPrivateRef) {
        const doc = await getDoc(userPrivateRef)
        if (doc.exists()) {
          return doc.data() as UserPrivate
        }
      }
      return null
    },
    {
      enabled: !!user,
      refetchOnWindowFocus: false,
      useErrorBoundary: true,
    },
  )

  return userPrivate
}
