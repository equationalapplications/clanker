import { useMemo, useState } from 'react'
import { Alert, Platform, ScrollView, StyleSheet, View } from 'react-native'
import { useSelector } from '@xstate/react'
import { Button, Card, Text, TextInput } from 'react-native-paper'
import { useAuthMachine } from '~/hooks/useMachines'
import {
  useAdminUsers,
  useClearAdminTerms,
  useDeleteAdminUser,
  useResetAdminUserState,
  useSetAdminUserCredits,
  useSetAdminUserSubscription,
} from '~/hooks/useAdminDashboard'
import { useDebouncedValue } from '~/hooks/useDebouncedValue'
import type { AdminPlanStatus, AdminPlanTier, AdminUserRow } from '~/types/admin'
import { UsersTable } from '~/components/admin/UsersTable'
import { UserActionPanel } from '~/components/admin/UserActionPanel'
import { AdminConfirmationModal } from '~/components/admin/ConfirmationModal'

type PendingAction =
  | { type: 'setCredits'; userId: string; credits: number }
  | {
      type: 'setSubscription'
      userId: string
      planTier: AdminPlanTier
      planStatus: AdminPlanStatus
      renewalDate?: string
    }
  | { type: 'clearTerms'; userId: string }
  | { type: 'resetUser'; userId: string }
  | { type: 'deleteUser'; userId: string }

const ADMIN_ENABLED = process.env.EXPO_PUBLIC_ADMIN_DASHBOARD_ENABLED === 'true'
const PLAN_TIER_FILTER_OPTIONS: AdminPlanTier[] = ['free', 'monthly_20', 'monthly_50', 'payg']
const PLAN_STATUS_FILTER_OPTIONS: AdminPlanStatus[] = ['active', 'cancelled', 'expired']

const normalizePlanTierFilter = (value: string) => {
  const trimmed = value.trim().toLowerCase()
  return PLAN_TIER_FILTER_OPTIONS.includes(trimmed as AdminPlanTier) ? trimmed : ''
}

const normalizePlanStatusFilter = (value: string) => {
  const trimmed = value.trim().toLowerCase()
  return PLAN_STATUS_FILTER_OPTIONS.includes(trimmed as AdminPlanStatus) ? trimmed : ''
}

const isUnauthorizedAccessError = (error: unknown) => {
  if (!error || typeof error !== 'object') {
    return false
  }

  const code = 'code' in error ? String((error as { code?: unknown }).code ?? '') : ''
  return code.includes('permission-denied') || code.includes('unauthenticated')
}

const accessErrorMessage = (error: unknown) => {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }
  return 'Unable to verify admin access right now.'
}

export default function AdminDashboardScreen() {
  const authService = useAuthMachine()
  const user = useSelector(authService, (state) => state.context.user)

  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [search, setSearch] = useState('')
  const [planTierFilter, setPlanTierFilter] = useState('')
  const [planStatusInput, setPlanStatusInput] = useState('')
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
  const debouncedSearch = useDebouncedValue(search, 300)
  const normalizedPlanTierFilter = useMemo(() => normalizePlanTierFilter(planTierFilter), [planTierFilter])
  const planStatusFilter = useMemo(() => normalizePlanStatusFilter(planStatusInput), [planStatusInput])
  const adminQueryEnabled = Platform.OS === 'web' && !!user && ADMIN_ENABLED

  const usersQuery = useAdminUsers(
    {
      page,
      pageSize,
      search: debouncedSearch,
      planTier: normalizedPlanTierFilter || undefined,
      planStatus: planStatusFilter || undefined,
    },
    adminQueryEnabled,
  )

  const setCreditsMutation = useSetAdminUserCredits()
  const setSubscriptionMutation = useSetAdminUserSubscription()
  const clearTermsMutation = useClearAdminTerms()
  const resetUserMutation = useResetAdminUserState()
  const deleteUserMutation = useDeleteAdminUser()

  const selectedUser = useMemo<AdminUserRow | null>(() => {
    const users = usersQuery.data?.users ?? []
    return users.find((entry) => entry.userId === selectedUserId) ?? null
  }, [selectedUserId, usersQuery.data?.users])

  const busy =
    setCreditsMutation.isPending ||
    setSubscriptionMutation.isPending ||
    clearTermsMutation.isPending ||
    resetUserMutation.isPending ||
    deleteUserMutation.isPending

  const totalCount = usersQuery.data?.totalCount
  const totalPages =
    typeof totalCount === 'number' && totalCount >= 0 ? Math.max(1, Math.ceil(totalCount / pageSize)) : null

  const showMessage = (title: string, message: string) => {
    Alert.alert(title, message)
  }

  const onConfirmAction = async (reason: string) => {
    if (!pendingAction) {
      return
    }

    try {
      if (pendingAction.type === 'setCredits') {
        await setCreditsMutation.mutateAsync({
          userId: pendingAction.userId,
          credits: pendingAction.credits,
          reason,
        })
        showMessage('Credits updated', 'User credits were successfully updated.')
      }

      if (pendingAction.type === 'setSubscription') {
        await setSubscriptionMutation.mutateAsync({
          userId: pendingAction.userId,
          planTier: pendingAction.planTier,
          planStatus: pendingAction.planStatus,
          renewalDate: pendingAction.renewalDate,
          reason,
        })
        showMessage('Subscription updated', 'User subscription was successfully updated.')
      }

      if (pendingAction.type === 'clearTerms') {
        await clearTermsMutation.mutateAsync({
          userId: pendingAction.userId,
          reason,
        })
        showMessage('Terms cleared', 'Terms acceptance fields were cleared for this user.')
      }

      if (pendingAction.type === 'resetUser') {
        await resetUserMutation.mutateAsync({
          userId: pendingAction.userId,
          reason,
        })
        showMessage('User reset', 'User app state was reset to initial defaults.')
      }

      if (pendingAction.type === 'deleteUser') {
        await deleteUserMutation.mutateAsync({
          userId: pendingAction.userId,
          reason,
        })
        showMessage('User deleted', 'User and linked data were permanently deleted.')
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown admin action failure.'
      showMessage('Admin action failed', message)
    } finally {
      setPendingAction(null)
    }
  }

  if (!ADMIN_ENABLED) {
    return (
      <View style={styles.centered}>
        <Text variant="headlineSmall">Admin dashboard is disabled.</Text>
      </View>
    )
  }

  if (adminQueryEnabled && usersQuery.isPending) {
    return (
      <View style={styles.centered}>
        <Text>Checking admin access...</Text>
      </View>
    )
  }

  if (adminQueryEnabled && usersQuery.error) {
    const unauthorized = isUnauthorizedAccessError(usersQuery.error)

    return (
      <View style={styles.centered}>
        <Text variant="headlineSmall">{unauthorized ? 'Unauthorized' : 'Access check failed'}</Text>
        <Text>
          {unauthorized
            ? 'Admin access is required for this page.'
            : accessErrorMessage(usersQuery.error)}
        </Text>
        {!unauthorized ? (
          <Button mode="outlined" onPress={() => usersQuery.refetch()}>
            Retry access check
          </Button>
        ) : null}
      </View>
    )
  }

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.pageContent}>
      <Text variant="headlineMedium">Admin Dashboard</Text>
      <Text style={styles.subtitle}>Web-only controls for privileged user management.</Text>

      <Card style={styles.filtersCard}>
        <Card.Content>
          <Text variant="titleMedium">User Directory Filters</Text>
          <View style={styles.filtersGrid}>
            <TextInput
              mode="outlined"
              label="Search email or user id"
              value={search}
              onChangeText={(value) => {
                setSearch(value)
                setPage(1)
              }}
            />
            <Text style={styles.filtersHint}>
              Email/name search runs server-side across all users; plan filters apply to the current page.
            </Text>
            <TextInput
              mode="outlined"
              label="Plan tier filter"
              value={planTierFilter}
              onChangeText={(value) => {
                setPlanTierFilter(value)
                setPage(1)
              }}
              placeholder="free, monthly_20, monthly_50, payg"
            />
            {planTierFilter.trim().length > 0 && !normalizedPlanTierFilter ? (
              <Text style={styles.filtersHint}>Plan tier must be one of: free, monthly_20, monthly_50, payg.</Text>
            ) : null}
            <TextInput
              mode="outlined"
              label="Plan status filter"
              value={planStatusInput}
              onChangeText={(value) => {
                setPlanStatusInput(value)
                setPage(1)
              }}
              placeholder="active, cancelled, expired"
            />
            {planStatusInput.trim().length > 0 && !planStatusFilter ? (
              <Text style={styles.filtersHint}>Plan status must be one of: active, cancelled, expired.</Text>
            ) : null}
          </View>
          <View style={styles.toolbar}>
            <Button mode="outlined" onPress={() => usersQuery.refetch()} disabled={usersQuery.isFetching}>
              Refresh
            </Button>
            <Text>Rows per page</Text>
            {[25, 50, 100].map((size) => (
              <Button
                key={size}
                mode={pageSize === size ? 'contained' : 'outlined'}
                onPress={() => {
                  setPageSize(size)
                  setPage(1)
                }}
                disabled={usersQuery.isFetching && pageSize === size}
              >
                {size}
              </Button>
            ))}
            <Button mode="contained" onPress={() => setPage((prev) => Math.max(1, prev - 1))} disabled={page === 1 || usersQuery.isFetching}>
              Previous
            </Button>
            <Text>{totalPages ? `Page ${page} of ${totalPages}` : `Page ${page}`}</Text>
            <Button mode="contained" onPress={() => setPage((prev) => prev + 1)} disabled={usersQuery.isFetching || !usersQuery.data?.hasMore}>
              Next
            </Button>
            {usersQuery.isFetching && !usersQuery.isLoading ? (
              <Text style={styles.fetchingHint}>Refreshing...</Text>
            ) : null}
          </View>
        </Card.Content>
      </Card>

      <View style={styles.contentGrid}>
        <View style={styles.tableColumn}>
          {usersQuery.isLoading ? <Text>Loading users...</Text> : null}
          <UsersTable
            users={usersQuery.data?.users ?? []}
            selectedUserId={selectedUserId}
            onSelectUser={setSelectedUserId}
          />
        </View>
        <View style={styles.actionsColumn}>
          <UserActionPanel
            user={selectedUser}
            isBusy={busy}
            onSetCredits={({ userId, credits }) => setPendingAction({ type: 'setCredits', userId, credits })}
            onSetSubscription={(payload) => setPendingAction({ type: 'setSubscription', ...payload })}
            onClearTerms={({ userId }) => setPendingAction({ type: 'clearTerms', userId })}
            onResetUserState={({ userId }) => setPendingAction({ type: 'resetUser', userId })}
            onDeleteUser={({ userId }) => setPendingAction({ type: 'deleteUser', userId })}
          />
        </View>
      </View>

      <AdminConfirmationModal
        visible={!!pendingAction}
        loading={busy}
        title={
          pendingAction?.type === 'deleteUser'
            ? 'Confirm Permanent User Deletion'
            : pendingAction?.type === 'resetUser'
              ? 'Confirm User State Reset'
              : 'Confirm Admin Action'
        }
        summary={
          pendingAction?.type === 'setCredits'
            ? `Set credits for user ${pendingAction.userId} to ${pendingAction.credits}.`
            : pendingAction?.type === 'setSubscription'
              ? `Set subscription for user ${pendingAction.userId} to ${pendingAction.planTier}/${pendingAction.planStatus}.`
              : pendingAction?.type === 'clearTerms'
                ? `Clear terms acceptance fields for user ${pendingAction.userId}.`
                : pendingAction?.type === 'resetUser'
                  ? `Reset user ${pendingAction.userId} to initial app state. This deletes user-generated app data.`
                  : pendingAction?.type === 'deleteUser'
                    ? `Permanently delete user ${pendingAction.userId}, including app data and auth identities.`
                    : ''
        }
        confirmLabel={pendingAction?.type === 'deleteUser' ? 'Delete User' : 'Confirm Action'}
        confirmKeyword={
          pendingAction?.type === 'deleteUser'
            ? 'DELETE'
            : pendingAction?.type === 'resetUser'
              ? 'RESET'
              : undefined
        }
        onCancel={() => setPendingAction(null)}
        onConfirm={onConfirmAction}
      />
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: '#f5eee5',
  },
  pageContent: {
    padding: 20,
    gap: 16,
  },
  subtitle: {
    opacity: 0.75,
    marginBottom: 8,
  },
  filtersCard: {
    borderRadius: 16,
    backgroundColor: '#fff8ef',
  },
  filtersGrid: {
    gap: 10,
    marginTop: 10,
  },
  filtersHint: {
    opacity: 0.7,
    fontSize: 12,
  },
  toolbar: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
  },
  fetchingHint: {
    opacity: 0.7,
  },
  contentGrid: {
    flexDirection: 'row',
    gap: 16,
    flexWrap: 'wrap',
  },
  tableColumn: {
    flex: 2,
    minWidth: 560,
  },
  actionsColumn: {
    flex: 1,
    minWidth: 320,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 8,
  },
})
