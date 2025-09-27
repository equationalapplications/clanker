import { httpsCallable } from "firebase/functions"
import { useMutation, useQueryClient } from "@tanstack/react-query"

import { useUserPrivate } from "./useUserPrivate"
import { functions } from "../config/firebaseConfig"

const acceptTermsFunction = httpsCallable(functions, "acceptTerms")

export function useAcceptTerms() {
  const userPrivate = useUserPrivate()
  const queryClient = useQueryClient()

  // const acceptTermsMutation = useMutation(() => acceptTermsFunction(), {
  //   // onMutate: () => {
  //   //   // Optimistically update the cache with the new hasAcceptedTermsDate field value
  //   //   const newUserPrivate = { ...userPrivate, hasAcceptedTermsDate: new Date() }
  //   //   queryClient.setQueryData("userPrivate", newUserPrivate)
  //   //
  //   //   // Return a rollback function to revert the optimistic update if the mutation fails
  //   //   return { userPrivate }
  //   // },
  // })

  return true;//acceptTermsMutation
}
