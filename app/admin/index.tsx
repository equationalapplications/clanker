import { useMemo, useState } from 'react'
import { Alert, Platform, ScrollView, StyleSheet, View } from 'react-native'
import { useSelector } from '@xstate/react'
import { Button, Card, Text, TextInput } from 'react-native-paper'
import { useAuthMachine } from '~/hooks/useMachines'
import {
  useAdminAccess,
  useAdminUsers,
  useClearAdminTerms,
  useDeleteAdminUser,
  useResetAdminUserState,
  useSetAdminUserCredits,
  useSetAdminUserSubscription,
} from '~/hooks/useAdminDashboard'
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

export default function AdminDashboardScreen() {
  const authService = useAuthMachine()
  const user = useSelector(authService, (state) => state.context.user)

  const [page, setPage] = useState(1)
  const [pageSize] = useState(25)
  const [search, setSearch] = useState('')
  const [planTierFilter, setPlanTierFilter] = useState('')
  const [planStatusFilter, setPlanStatusFilter] = useState('')
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)

  const accessQuery = useAdminAccess(Platform.OS === 'web' && !!user && ADMIN_ENABLED)
  const usersQuery = useAdminUsers(
    {
      page,
      pageSize,
      search,
      planTier: planTierFilter || undefined,
      planStatus: planStatusFilter || undefined,
    },
    accessQuery.isSuccess,
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

  if (accessQuery.isPending) {
    return (
      <View style={styles.centered}>
        <Text>Checking admin access...</Text>
      </View>
    )
  }

  if (accessQuery.error) {
    return (
      <View style={styles.centered}>
        <Text variant="headlineSmall">Unauthorized</Text>
        <Text>Admin access is required for this page.</Text>
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
              onChangeText={setSearch}
            />
            <TextInput
              mode="outlined"
              label="Plan tier filter"
              value={planTierFilter}
              onChangeText={setPlanTierFilter}
              placeholder="free, monthly_20, monthly_50, payg"
            />
            <TextInput
              mode="outlined"
              label="Plan status filter"
              value={planStatusFilter}
              onChangeText={setPlanStatusFilter}
              placeholder="active, canceled, past_due, paused, trialing"
            />
          </View>
          <View style={styles.toolbar}>
            <Button mode="outlined" onPress={() => usersQuery.refetch()} disabled={usersQuery.isFetching}>
              Refresh
            </Button>
            <Button mode="contained" onPress={() => setPage((prev) => Math.max(1, prev - 1))} disabled={page === 1 || usersQuery.isFetching}>
              Previous
            </Button>
            <Text>Page {page}</Text>
            <Button mode="contained" onPress={() => setPage((prev) => prev + 1)} disabled={usersQuery.isFetching || !usersQuery.data?.hasMore}>
              Next
            </Button>
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
  toolbar: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
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
