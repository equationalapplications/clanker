import React, { useState } from 'react'
import { StyleSheet, ScrollView, View } from 'react-native'
import { Text, List, Switch, Button, Divider } from 'react-native-paper'
import { router } from 'expo-router'
import { useAuth } from '~/auth/useAuth'
import { useSettings } from '~/contexts/SettingsContext'
import CombinedSubscriptionButton from '~/components/CombinedSubscriptionButton'
import LoadingIndicator from '~/components/LoadingIndicator'
import pkg from '../../package.json'

const version = pkg.version

export default function Settings() {
  const { user, signOut } = useAuth()
  const { settings, updateSetting } = useSettings()
  const [isLoading, setIsLoading] = useState(false)

  const onChangeIsLoading = (isLoading: boolean) => {
    setIsLoading(isLoading)
  }

  const onPressProfile = () => {
    router.push('./profile')
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.section}>
        <Text variant="headlineSmall" style={styles.sectionTitle}>
          Account
        </Text>

        {user && (
          <List.Item
            title="Email"
            description={user.email || 'No email'}
            left={(props) => <List.Icon {...props} icon="email" />}
          />
        )}

        <List.Item
          title="Profile"
          description="Manage your profile"
          left={(props) => <List.Icon {...props} icon="account-circle" />}
          right={(props) => <List.Icon {...props} icon="chevron-right" />}
          onPress={onPressProfile}
        />
      </View>

      <Divider />

      <View style={styles.section}>
        <Text variant="headlineSmall" style={styles.sectionTitle}>
          Subscription
        </Text>
        {isLoading && <LoadingIndicator />}
        <CombinedSubscriptionButton onChangeIsLoading={onChangeIsLoading} />
      </View>

      <Divider />

      <View style={styles.section}>
        <Text variant="headlineSmall" style={styles.sectionTitle}>
          Preferences
        </Text>

        <List.Item
          title="Dark Mode"
          description="Use dark theme"
          left={(props) => <List.Icon {...props} icon="theme-light-dark" />}
          right={() => <Switch value={settings.darkMode} onValueChange={(v) => updateSetting('darkMode', v)} />}
        />

        <List.Item
          title="Notifications"
          description="Receive push notifications"
          left={(props) => <List.Icon {...props} icon="bell" />}
          right={() => <Switch value={settings.notifications} onValueChange={(v) => updateSetting('notifications', v)} />}
        />

        <List.Item
          title="Analytics"
          description="Help improve the app"
          left={(props) => <List.Icon {...props} icon="chart-line" />}
          right={() => <Switch value={settings.analytics} onValueChange={(v) => updateSetting('analytics', v)} />}
        />
      </View>

      <Divider />

      <View style={styles.section}>
        <Text variant="headlineSmall" style={styles.sectionTitle}>
          About
        </Text>

        <List.Item
          title="Terms of Service"
          left={(props) => <List.Icon {...props} icon="file-document" />}
          right={(props) => <List.Icon {...props} icon="chevron-right" />}
          onPress={() => router.push('/terms')}
        />

        <List.Item
          title="Privacy Policy"
          left={(props) => <List.Icon {...props} icon="shield-check" />}
          right={(props) => <List.Icon {...props} icon="chevron-right" />}
          onPress={() => router.push('/privacy')}
        />

        <List.Item
          title="App Version"
          description={version}
          left={(props) => <List.Icon {...props} icon="information" />}
        />
      </View>

      <Divider />

      <View style={styles.section}>
        <Button mode="outlined" onPress={signOut} icon="logout" style={styles.signOutButton}>
          Sign Out
        </Button>
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  section: {
    padding: 16,
  },
  sectionTitle: {
    marginBottom: 8,
    fontWeight: '600',
  },
  signOutButton: {
    marginTop: 16,
  },
})
