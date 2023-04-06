import { doc, getDoc } from "firebase/firestore"
import { useQuery } from "react-query"

import { usersPublicCollection } from "../config/constants"
import { auth, firestore } from "../config/firebaseConfig"

interface UserPublic {
  uid: string
  name: string
  avatar: string
  email: string
}

export default function useUserPublic(): UserPublic | null {
  const { data: userPublic } = useQuery<UserPublic>(
    "userPublic",
    async () => {
      const user = auth.currentUser

      if (user) {
        const userPublicRef = doc(firestore, `${usersPublicCollection}/${user.uid}`)
        const docSnap = await getDoc(userPublicRef)

        if (docSnap.exists()) {
          const data = docSnap.data() as UserPublic
          return data
        }
      }
      return null
    },
    {
      enabled: !!auth.currentUser,
      refetchOnWindowFocus: false,
      useErrorBoundary: true,
    },
  )

  return userPublic ?? null
}
