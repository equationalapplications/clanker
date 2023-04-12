import { useMutation } from "react-query"

import { postStripeReceipt } from "../utilities/postStripeReceipt"

export const usePostStripeReceipt = () => {
  const { mutate, error } = useMutation((sessionId: string) => postStripeReceipt(sessionId), {
    retry: 3,
    retryDelay: 30000,
    useErrorBoundary: true,
  })
  return { mutate, error }
}
