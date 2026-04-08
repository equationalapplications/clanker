import { StyleSheet, View } from 'react-native'
import { DataTable, Text } from 'react-native-paper'
import type { AdminUserRow } from '~/types/admin'

interface UsersTableProps {
  users: AdminUserRow[]
  selectedUserId: string | null
  onSelectUser: (userId: string) => void
}

export function UsersTable({ users, selectedUserId, onSelectUser }: UsersTableProps) {
  if (users.length === 0) {
    return <Text>No users matched the current filters.</Text>
  }

  return (
    <View style={styles.container}>
      <DataTable>
        <DataTable.Header>
          <DataTable.Title>Email</DataTable.Title>
          <DataTable.Title>User ID</DataTable.Title>
          <DataTable.Title numeric>Credits</DataTable.Title>
          <DataTable.Title>Tier</DataTable.Title>
          <DataTable.Title>Status</DataTable.Title>
          <DataTable.Title>Terms</DataTable.Title>
        </DataTable.Header>

        {users.map((user) => {
          const selected = user.userId === selectedUserId
          return (
            <DataTable.Row
              key={user.userId}
              style={selected ? styles.selectedRow : undefined}
              onPress={() => onSelectUser(user.userId)}
            >
              <DataTable.Cell>{user.email}</DataTable.Cell>
              <DataTable.Cell>{user.userId.slice(0, 12)}...</DataTable.Cell>
              <DataTable.Cell numeric>{user.currentCredits}</DataTable.Cell>
              <DataTable.Cell>{user.planTier}</DataTable.Cell>
              <DataTable.Cell>{user.planStatus}</DataTable.Cell>
              <DataTable.Cell>{user.termsAcceptedAt ? 'Accepted' : 'Not accepted'}</DataTable.Cell>
            </DataTable.Row>
          )
        })}
      </DataTable>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 8,
  },
  selectedRow: {
    backgroundColor: 'rgba(255, 196, 120, 0.22)',
  },
})
