import {
  adminClearTermsAcceptanceFn,
  adminDeleteUserFn,
  adminListUsersFn,
  adminResetUserStateFn,
  adminSetUserCreditsFn,
  adminSetUserSubscriptionFn,
  appCheckReady,
} from '~/config/firebaseConfig'
import type {
  AdminListUsersResponse,
  AdminMutationResponse,
  AdminPlanStatus,
  AdminPlanTier,
} from '~/types/admin'

const ensureReason = (reason: string) => {
  const trimmed = reason.trim()
  if (!trimmed) {
    throw new Error('Reason is required for admin actions.')
  }
  return trimmed
}

const makeRequestId = () => {
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

const ensureEnabled = () => {
  if (process.env.EXPO_PUBLIC_ADMIN_DASHBOARD_ENABLED !== 'true') {
    throw new Error('Admin dashboard is disabled by configuration.')
  }
}

async function callAdmin<T>(fn: (payload: unknown) => Promise<{ data: T }>, payload: unknown): Promise<T> {
  ensureEnabled()
  await appCheckReady
  const response = await fn(payload)
  return response.data
}

export async function listAdminUsers(params: {
  page: number
  pageSize: number
  search?: string
  planTier?: string
  planStatus?: string
}): Promise<AdminListUsersResponse> {
  return callAdmin<AdminListUsersResponse>(adminListUsersFn as never, params)
}

export async function setAdminUserCredits(input: {
  userId: string
  credits: number
  reason: string
}): Promise<AdminMutationResponse> {
  return callAdmin<AdminMutationResponse>(adminSetUserCreditsFn as never, {
    userId: input.userId,
    credits: input.credits,
    reason: ensureReason(input.reason),
    requestId: makeRequestId(),
  })
}

export async function setAdminUserSubscription(input: {
  userId: string
  planTier: AdminPlanTier
  planStatus: AdminPlanStatus
  renewalDate?: string
  reason: string
}): Promise<AdminMutationResponse> {
  return callAdmin<AdminMutationResponse>(adminSetUserSubscriptionFn as never, {
    userId: input.userId,
    planTier: input.planTier,
    planStatus: input.planStatus,
    renewalDate: input.renewalDate ?? null,
    reason: ensureReason(input.reason),
    requestId: makeRequestId(),
  })
}

export async function clearAdminTerms(input: {
  userId: string
  reason: string
}): Promise<AdminMutationResponse> {
  return callAdmin<AdminMutationResponse>(adminClearTermsAcceptanceFn as never, {
    userId: input.userId,
    reason: ensureReason(input.reason),
    requestId: makeRequestId(),
  })
}

export async function resetAdminUserState(input: {
  userId: string
  reason: string
}): Promise<AdminMutationResponse> {
  return callAdmin<AdminMutationResponse>(adminResetUserStateFn as never, {
    userId: input.userId,
    reason: ensureReason(input.reason),
    requestId: makeRequestId(),
  })
}

export async function deleteAdminUser(input: {
  userId: string
  reason: string
}): Promise<AdminMutationResponse> {
  return callAdmin<AdminMutationResponse>(adminDeleteUserFn as never, {
    userId: input.userId,
    reason: ensureReason(input.reason),
    requestId: makeRequestId(),
  })
}
