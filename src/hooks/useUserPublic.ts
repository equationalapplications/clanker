import { doc, getDoc } from "firebase/firestore"
import { useQuery } from "@tanstack/react-query"

import { usersPublicCollection } from "../config/constants"
import { auth, firestore } from "../config/firebaseConfig"

// Also import Supabase hooks for migration
import { useSupabaseUserPublic } from "./useSupabaseUserProfile"

interface UserPublic {
  uid: string
  name: string
  avatar: string
  email: string
}

export function useUserPublic(): UserPublic | null {
  // Use Supabase version for now
  const supabaseUserPublic = useSupabaseUserPublic()

  // Return Supabase data if available, otherwise fall back to Firebase
  if (supabaseUserPublic) {
    return supabaseUserPublic
  }

  const { data: userPublic } = useQuery<UserPublic>({
    queryKey: ["userPublic"],
    queryFn: async () => {
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
    enabled: !!auth.currentUser,
    refetchOnWindowFocus: false,
  })

  return userPublic ?? null
}
