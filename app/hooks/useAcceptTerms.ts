import { httpsCallable } from "firebase/functions"
import { useMutation, useQueryClient } from "react-query"

import { functions } from "../config/firebaseConfig"
import useUserPrivate from "./useUserPrivate"

const acceptTermsFunction = httpsCallable(functions, "acceptTerms")

export function useAcceptTerms() {
  const userPrivate = useUserPrivate()
  const queryClient = useQueryClient()

  const acceptTermsMutation = useMutation(() => acceptTermsFunction(), {
    // onMutate: () => {
    //   // Optimistically update the cache with the new hasAcceptedTermsDate field value
    //   const newUserPrivate = { ...userPrivate, hasAcceptedTermsDate: new Date() }
    //   queryClient.setQueryData("userPrivate", newUserPrivate)
    //
    //   // Return a rollback function to revert the optimistic update if the mutation fails
    //   return { userPrivate }
    // },
  })

  return acceptTermsMutation
}
