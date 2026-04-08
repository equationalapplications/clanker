export type AdminPlanTier = 'free' | 'monthly_20' | 'monthly_50' | 'payg'

export type AdminPlanStatus = 'active' | 'canceled' | 'past_due' | 'paused' | 'trialing'

export interface AdminUserRow {
  userId: string
  email: string
  createdAt: string | null
  planTier: AdminPlanTier
  planStatus: AdminPlanStatus
  currentCredits: number
  termsAcceptedAt: string | null
  termsVersion: string | null
}

export interface AdminListUsersResponse {
  success: boolean
  users: AdminUserRow[]
  page: number
  pageSize: number
  totalCount?: number
  hasMore: boolean
}

export interface AdminMutationResponse {
  success: boolean
  action: string
  targetUserId: string
  requestId: string
  applied: Record<string, unknown>
}
