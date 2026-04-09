import { StyleSheet, View } from 'react-native'
import { DataTable, Text, useTheme } from 'react-native-paper'
import type { AdminUserRow } from '~/types/admin'

interface UsersTableProps {
  users: AdminUserRow[]
  selectedUserId: string | null
  onSelectUser: (userId: string) => void
}

export function UsersTable({ users, selectedUserId, onSelectUser }: UsersTableProps) {
  const theme = useTheme()

  if (users.length === 0) {
    return <Text style={[styles.emptyText, { color: theme.colors.onSurfaceVariant }]}>No users matched the current filters.</Text>
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.surface }]}>
      <DataTable>
        <DataTable.Header>
          <DataTable.Title textStyle={[styles.headerText, { color: theme.colors.onSurface }]}>Email</DataTable.Title>
          <DataTable.Title textStyle={[styles.headerText, { color: theme.colors.onSurface }]}>User ID</DataTable.Title>
          <DataTable.Title numeric textStyle={[styles.headerText, { color: theme.colors.onSurface }]}>Credits</DataTable.Title>
          <DataTable.Title textStyle={[styles.headerText, { color: theme.colors.onSurface }]}>Tier</DataTable.Title>
          <DataTable.Title textStyle={[styles.headerText, { color: theme.colors.onSurface }]}>Status</DataTable.Title>
          <DataTable.Title textStyle={[styles.headerText, { color: theme.colors.onSurface }]}>Terms</DataTable.Title>
        </DataTable.Header>

        {users.map((user) => {
          const selected = user.userId === selectedUserId
          return (
            <DataTable.Row
              key={user.userId}
              style={[
                styles.row,
                { borderBottomColor: theme.colors.outlineVariant },
                selected ? { backgroundColor: theme.colors.secondaryContainer } : undefined,
              ]}
              onPress={() => onSelectUser(user.userId)}
            >
              <DataTable.Cell textStyle={[styles.cellText, { color: theme.colors.onSurface }]}>{user.email}</DataTable.Cell>
              <DataTable.Cell textStyle={[styles.userIdText, { color: theme.colors.onSurface }]}>{user.userId}</DataTable.Cell>
              <DataTable.Cell numeric textStyle={[styles.cellText, { color: theme.colors.onSurface }]}>{user.currentCredits}</DataTable.Cell>
              <DataTable.Cell textStyle={[styles.cellText, { color: theme.colors.onSurface }]}>{user.planTier}</DataTable.Cell>
              <DataTable.Cell textStyle={[styles.cellText, { color: theme.colors.onSurface }]}>{user.planStatus}</DataTable.Cell>
              <DataTable.Cell textStyle={[styles.cellText, { color: theme.colors.onSurface }]}>{user.termsAcceptedAt ? 'Accepted' : 'Not accepted'}</DataTable.Cell>
            </DataTable.Row>
          )
        })}
      </DataTable>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 16,
    padding: 8,
  },
  row: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerText: {
    fontWeight: '700',
  },
  cellText: {
    fontWeight: '500',
  },
  userIdText: {
    fontFamily: 'monospace',
    fontWeight: '500',
    flexShrink: 1,
  },
  emptyText: {},
})
