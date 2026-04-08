import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  clearAdminTerms,
  deleteAdminUser,
  listAdminUsers,
  resetAdminUserState,
  setAdminUserCredits,
  setAdminUserSubscription,
} from '~/services/adminService'
import type { AdminPlanStatus, AdminPlanTier } from '~/types/admin'

interface AdminUsersQueryInput {
  page: number
  pageSize: number
  search: string
  planTier?: string
  planStatus?: string
}

const adminUsersKey = (input: AdminUsersQueryInput) => ['adminUsers', input] as const

export function useAdminUsers(input: AdminUsersQueryInput, enabled: boolean) {
  return useQuery({
    queryKey: adminUsersKey(input),
    queryFn: () => listAdminUsers(input),
    enabled,
    staleTime: 10_000,
    placeholderData: keepPreviousData,
  })
}

export function useSetAdminUserCredits() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ userId, credits, reason }: { userId: string; credits: number; reason: string }) =>
      setAdminUserCredits({ userId, credits, reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminUsers'] })
    },
  })
}

export function useSetAdminUserSubscription() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: {
      userId: string
      planTier: AdminPlanTier
      planStatus: AdminPlanStatus
      renewalDate?: string
      reason: string
    }) => setAdminUserSubscription(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminUsers'] })
    },
  })
}

export function useClearAdminTerms() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ userId, reason }: { userId: string; reason: string }) =>
      clearAdminTerms({ userId, reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminUsers'] })
    },
  })
}

export function useResetAdminUserState() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ userId, reason }: { userId: string; reason: string }) =>
      resetAdminUserState({ userId, reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminUsers'] })
    },
  })
}

export function useDeleteAdminUser() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ userId, reason }: { userId: string; reason: string }) =>
      deleteAdminUser({ userId, reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminUsers'] })
    },
  })
}
