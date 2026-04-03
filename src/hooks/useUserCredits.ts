import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSelector } from '@xstate/react'
import { getUserCredits, deductCredits } from '~/utilities/getUserCredits'
import { useAuthMachine } from '~/hooks/useMachines'

export const useUserCredits = () => {
  const authService = useAuthMachine();
  const { user } = useSelector(authService, (state) => ({
    user: state.context.user,
  }));

  return useQuery({
    queryKey: ['userCredits', user?.uid],
    queryFn: getUserCredits,
    enabled: !!user,
    staleTime: 1000 * 10, // 10 seconds - credits change frequently
    refetchInterval: 1000 * 30, // Refetch every 30 seconds
  })
}

export const useDeductCredits = () => {
  const queryClient = useQueryClient()
  const authService = useAuthMachine();
  const { user } = useSelector(authService, (state) => ({
    user: state.context.user,
  }));

  return useMutation({
    mutationFn: ({ amount, description }: { amount: number; description?: string }) =>
      deductCredits(amount, description),
    onSuccess: () => {
      // Immediately refetch credits after deduction
      queryClient.invalidateQueries({ queryKey: ['userCredits', user?.uid] })
    },
    onError: (error) => {
      console.error('Failed to deduct credits:', error)
    },
  })
}
