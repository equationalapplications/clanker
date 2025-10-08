import { useMutation } from '@tanstack/react-query'

import { postStripeReceipt } from '~/utilities/postStripeReceipt'

export const usePostStripeReceipt = () => {
  const { mutate, error } = useMutation({
    mutationFn: (sessionId: string) => postStripeReceipt(sessionId),
    retry: 3,
    retryDelay: 30000,
    throwOnError: true,
  })
  return { mutate, error }
}
