import React from 'react'
import { StyleSheet, ScrollView, View } from 'react-native'
import { Text, List, Switch, Button, Divider } from 'react-native-paper'
import { router, type Href } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useSelector } from '@xstate/react'
import { useAuthMachine } from '~/hooks/useMachines'
import { useSettings } from '~/contexts/SettingsContext'
import pkg from '../../package.json'

const version = pkg.version

export default function Settings() {
  const authService = useAuthMachine()
  const { user } = useSelector(authService, (state) => ({
    user: state.context.user,
  }))
  const { settings, updateSetting } = useSettings()
  const { bottom } = useSafeAreaInsets()

  const signOut = () => {
    authService.send({ type: 'SIGN_OUT' })
  }

  const onPressProfile = () => {
    router.push('./profile')
  }

  const onPressSubscribe = () => {
    router.push('./subscribe')
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: bottom + 16 }}>
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

        <List.Item
          title="Subscribe"
          description="Manage your subscription"
          left={(props) => <List.Icon {...props} icon="crown" />}
          right={(props) => <List.Icon {...props} icon="chevron-right" />}
          onPress={onPressSubscribe}
        />
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
          right={() => (
            <Switch value={settings.darkMode} onValueChange={(v) => updateSetting('darkMode', v)} />
          )}
        />

        <List.Item
          title="Notifications"
          description="Receive push notifications"
          left={(props) => <List.Icon {...props} icon="bell" />}
          right={() => (
            <Switch
              value={settings.notifications}
              onValueChange={(v) => updateSetting('notifications', v)}
            />
          )}
        />

        <List.Item
          title="Analytics"
          description="Help improve the app"
          left={(props) => <List.Icon {...props} icon="chart-line" />}
          right={() => (
            <Switch
              value={settings.analytics}
              onValueChange={(v) => updateSetting('analytics', v)}
            />
          )}
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
          title="Support"
          description="Contact support and view FAQs"
          left={(props) => <List.Icon {...props} icon="lifebuoy" />}
          right={(props) => <List.Icon {...props} icon="chevron-right" />}
          onPress={() => router.push('/support' as Href)}
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
