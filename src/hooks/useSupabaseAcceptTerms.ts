import { useMutation, useQueryClient } from '@tanstack/react-query'
import { acceptTerms } from '../services/userService'

/**
 * Hook to accept terms using Supabase
 */
export function useSupabaseAcceptTerms() {
    const queryClient = useQueryClient()

    const acceptTermsMutation = useMutation({
        mutationFn: (termsVersion: string = '1.0') => acceptTerms(termsVersion),
        onSuccess: () => {
            // Invalidate relevant queries
            queryClient.invalidateQueries({ queryKey: ['userProfile'] })
            queryClient.invalidateQueries({ queryKey: ['userPrivate'] })
        },
    })

    return acceptTermsMutation
}