import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getUserCredits, deductCredits } from '../utilities/getUserCredits'
import { useAuth } from './useAuth'

export const useUserCredits = () => {
    const { user } = useAuth()

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
    const { user } = useAuth()

    return useMutation({
        mutationFn: (amount: number) => deductCredits(amount),
        onSuccess: () => {
            // Immediately refetch credits after deduction
            queryClient.invalidateQueries({ queryKey: ['userCredits', user?.uid] })
        },
        onError: (error) => {
            console.error('Failed to deduct credits:', error)
        },
    })
}