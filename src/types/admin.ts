export type AdminPlanTier = 'free' | 'monthly_20' | 'monthly_50' | 'payg'

export type AdminPlanStatus = 'active' | 'cancelled' | 'expired'

export type AdminDisplayPlanTier = AdminPlanTier | 'unknown'

export type AdminDisplayPlanStatus = AdminPlanStatus | 'unknown'

export interface AdminUserRow {
  userId: string
  email: string
  createdAt: string | null
  planTier: AdminDisplayPlanTier
  planStatus: AdminDisplayPlanStatus
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
