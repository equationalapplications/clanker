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

type Callable<Req, Res> = (payload: Req) => Promise<{ data: Res }>

interface ListAdminUsersRequest {
  page: number
  pageSize: number
  search?: string
  planTier?: AdminPlanTier
  planStatus?: AdminPlanStatus
}

interface SetAdminUserCreditsRequest {
  userId: string
  credits: number
  reason: string
  requestId: string
}

interface SetAdminUserSubscriptionRequest {
  userId: string
  planTier: AdminPlanTier
  planStatus: AdminPlanStatus
  renewalDate: string | null
  reason: string
  requestId: string
}

interface AdminMutationRequest {
  userId: string
  reason: string
  requestId: string
}

const ensureReason = (reason: string) => {
  const trimmed = reason.trim()
  if (!trimmed) {
    throw new Error('Reason is required for admin actions.')
  }
  return trimmed
}

const makeRequestId = () => {
  const uuid = globalThis.crypto?.randomUUID?.()
  if (uuid) {
    return `req-${uuid}`
  }

  if (globalThis.crypto?.getRandomValues) {
    const bytes = new Uint8Array(16)
    globalThis.crypto.getRandomValues(bytes)
    bytes[6] = (bytes[6] & 0x0f) | 0x40
    bytes[8] = (bytes[8] & 0x3f) | 0x80
    const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')
    return `req-${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }

  throw new Error('Secure random generator unavailable for request IDs.')
}

const ensureEnabled = () => {
  if (process.env.EXPO_PUBLIC_ADMIN_DASHBOARD_ENABLED !== 'true') {
    throw new Error('Admin dashboard is disabled by configuration.')
  }
}

const ensureAppCheckConfigured = () => {
  const isWeb = typeof window !== 'undefined' && typeof document !== 'undefined'
  if (!isWeb) {
    return
  }

  const siteKey = process.env.EXPO_PUBLIC_RECAPTCHA_SITE_KEY?.trim()
  if (!siteKey) {
    throw new Error('App Check is not configured for admin actions. Set EXPO_PUBLIC_RECAPTCHA_SITE_KEY.')
  }
}

async function callAdmin<Req, Res>(fn: Callable<Req, Res>, payload: Req): Promise<Res> {
  ensureEnabled()
  ensureAppCheckConfigured()
  try {
    await appCheckReady
  } catch {
    throw new Error('App Check initialization failed for admin actions.')
  }
  const response = await fn(payload)
  return response.data
}

const adminListUsersCallable = adminListUsersFn as Callable<ListAdminUsersRequest, AdminListUsersResponse>
const adminSetUserCreditsCallable = adminSetUserCreditsFn as Callable<SetAdminUserCreditsRequest, AdminMutationResponse>
const adminSetUserSubscriptionCallable =
  adminSetUserSubscriptionFn as Callable<SetAdminUserSubscriptionRequest, AdminMutationResponse>
const adminClearTermsAcceptanceCallable =
  adminClearTermsAcceptanceFn as Callable<AdminMutationRequest, AdminMutationResponse>
const adminResetUserStateCallable = adminResetUserStateFn as Callable<AdminMutationRequest, AdminMutationResponse>
const adminDeleteUserCallable = adminDeleteUserFn as Callable<AdminMutationRequest, AdminMutationResponse>

export async function listAdminUsers(params: {
  page: number
  pageSize: number
  search?: string
  planTier?: AdminPlanTier
  planStatus?: AdminPlanStatus
}): Promise<AdminListUsersResponse> {
  return callAdmin(adminListUsersCallable, params)
}

export async function setAdminUserCredits(input: {
  userId: string
  credits: number
  reason: string
}): Promise<AdminMutationResponse> {
  return callAdmin(adminSetUserCreditsCallable, {
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
  return callAdmin(adminSetUserSubscriptionCallable, {
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
  return callAdmin(adminClearTermsAcceptanceCallable, {
    userId: input.userId,
    reason: ensureReason(input.reason),
    requestId: makeRequestId(),
  })
}

export async function resetAdminUserState(input: {
  userId: string
  reason: string
}): Promise<AdminMutationResponse> {
  return callAdmin(adminResetUserStateCallable, {
    userId: input.userId,
    reason: ensureReason(input.reason),
    requestId: makeRequestId(),
  })
}

export async function deleteAdminUser(input: {
  userId: string
  reason: string
}): Promise<AdminMutationResponse> {
  return callAdmin(adminDeleteUserCallable, {
    userId: input.userId,
    reason: ensureReason(input.reason),
    requestId: makeRequestId(),
  })
}
