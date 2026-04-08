import { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { Button, Card, Menu, Text, TextInput } from 'react-native-paper'
import type { AdminPlanStatus, AdminPlanTier, AdminUserRow } from '~/types/admin'

const PLAN_TIERS: AdminPlanTier[] = ['free', 'monthly_20', 'monthly_50', 'payg']
const PLAN_STATUSES: AdminPlanStatus[] = ['active', 'cancelled', 'expired']

interface UserActionPanelProps {
  user: AdminUserRow | null
  onSetCredits: (payload: { userId: string; credits: number }) => void
  onSetSubscription: (payload: {
    userId: string
    planTier: AdminPlanTier
    planStatus: AdminPlanStatus
    renewalDate?: string
  }) => void
  onClearTerms: (payload: { userId: string }) => void
  onResetUserState: (payload: { userId: string }) => void
  onDeleteUser: (payload: { userId: string }) => void
  isBusy: boolean
}

export function UserActionPanel({
  user,
  onSetCredits,
  onSetSubscription,
  onClearTerms,
  onResetUserState,
  onDeleteUser,
  isBusy,
}: UserActionPanelProps) {
  const [creditsText, setCreditsText] = useState('50')
  const [planTier, setPlanTier] = useState<AdminPlanTier>('free')
  const [planStatus, setPlanStatus] = useState<AdminPlanStatus>('active')
  const [renewalDate, setRenewalDate] = useState('')
  const [tierMenuVisible, setTierMenuVisible] = useState(false)
  const [statusMenuVisible, setStatusMenuVisible] = useState(false)

  useEffect(() => {
    if (!user) {
      return
    }
    setCreditsText(String(user.currentCredits))
    setPlanTier(user.planTier)
    setPlanStatus(user.planStatus)
    setRenewalDate('')
  }, [user])

  if (!user) {
    return (
      <Card style={styles.card}>
        <Card.Content>
          <Text variant="titleMedium">Select a user to manage actions.</Text>
        </Card.Content>
      </Card>
    )
  }

  const trimmedCreditsText = creditsText.trim()
  const credits = Number.parseInt(trimmedCreditsText, 10)
  const creditsIsValid = /^\d+$/.test(trimmedCreditsText)

  return (
    <Card style={styles.card}>
      <Card.Content>
        <Text variant="titleLarge">Selected User</Text>
        <Text style={styles.rowLabel}>{user.email}</Text>
        <Text style={styles.rowSubLabel}>{user.userId}</Text>

        <View style={styles.section}>
          <Text variant="titleMedium">Adjust Credits</Text>
          <TextInput
            mode="outlined"
            label="Absolute credits"
            keyboardType="numeric"
            value={creditsText}
            onChangeText={setCreditsText}
          />
          <Button
            mode="contained"
            onPress={() => onSetCredits({ userId: user.userId, credits })}
            disabled={isBusy || !creditsIsValid}
          >
            Set Credits
          </Button>
        </View>

        <View style={styles.section}>
          <Text variant="titleMedium">Adjust Subscription</Text>
          <View style={styles.menuRow}>
            <Menu
              visible={tierMenuVisible}
              onDismiss={() => setTierMenuVisible(false)}
              anchor={
                <Button mode="outlined" onPress={() => setTierMenuVisible(true)}>
                  Tier: {planTier}
                </Button>
              }
            >
              {PLAN_TIERS.map((tier) => (
                <Menu.Item
                  key={tier}
                  onPress={() => {
                    setPlanTier(tier)
                    setTierMenuVisible(false)
                  }}
                  title={tier}
                />
              ))}
            </Menu>
            <Menu
              visible={statusMenuVisible}
              onDismiss={() => setStatusMenuVisible(false)}
              anchor={
                <Button mode="outlined" onPress={() => setStatusMenuVisible(true)}>
                  Status: {planStatus}
                </Button>
              }
            >
              {PLAN_STATUSES.map((status) => (
                <Menu.Item
                  key={status}
                  onPress={() => {
                    setPlanStatus(status)
                    setStatusMenuVisible(false)
                  }}
                  title={status}
                />
              ))}
            </Menu>
          </View>
          <TextInput
            mode="outlined"
            label="Renewal date (ISO, optional)"
            value={renewalDate}
            onChangeText={setRenewalDate}
          />
          <Button
            mode="contained"
            onPress={() =>
              onSetSubscription({
                userId: user.userId,
                planTier,
                planStatus,
                renewalDate: renewalDate.trim() || undefined,
              })
            }
            disabled={isBusy}
          >
            Set Subscription
          </Button>
        </View>

        <View style={styles.section}>
          <Text variant="titleMedium">Compliance + Destructive Actions</Text>
          <Button mode="outlined" onPress={() => onClearTerms({ userId: user.userId })} disabled={isBusy}>
            Clear Terms Acceptance
          </Button>
          <Button mode="outlined" onPress={() => onResetUserState({ userId: user.userId })} disabled={isBusy}>
            Reset User State
          </Button>
          <Button
            mode="contained"
            buttonColor="#9d2f2f"
            onPress={() => onDeleteUser({ userId: user.userId })}
            disabled={isBusy}
          >
            Permanently Delete User
          </Button>
        </View>
      </Card.Content>
    </Card>
  )
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
  },
  rowLabel: {
    marginTop: 4,
  },
  rowSubLabel: {
    opacity: 0.65,
    fontSize: 12,
    marginBottom: 12,
  },
  section: {
    marginTop: 16,
    gap: 10,
  },
  menuRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
})
