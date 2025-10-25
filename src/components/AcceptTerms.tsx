import { StatusBar } from 'expo-status-bar'
import { useState } from 'react'
import { StyleSheet, View, Alert, Platform } from 'react-native'
import { Text, Checkbox } from 'react-native-paper'
import { router } from 'expo-router'

import Button from '~/components/Button'
import Logo from '~/components/Logo'
import { supabaseClient } from '~/config/supabaseClient'
import { useAuth } from '~/auth/useAuth'
import { grantAppAccess } from '~/utilities/appAccess'
import { TERMS } from '~/config/termsConfig'
//import { authManager } from "~/utilities/authManager"

interface AcceptTermsProps {
  onAccepted?: () => void
  onCanceled?: () => void
  isUpdate?: boolean
}

export function AcceptTerms({ onAccepted, onCanceled, isUpdate = false }: AcceptTermsProps) {
  const [checked, setChecked] = useState(false)
  const { signOut } = useAuth()

  const onPressChecked = () => {
    setChecked(!checked)
  }

  const onPressAccept = async () => {
    if (!checked) {
      Alert.alert('Please Accept Terms', 'You must accept the terms and conditions to continue.')
      return
    }

    try {
      console.log('Accepting terms and granting app access...')

      // Optimistically proceed - we trust the user clicked accept
      // The database write happens in the background
      const result = await grantAppAccess('clanker', TERMS.version)

      if (result.success) {
        console.log('Terms accepted successfully, proceeding to app...')

        // Immediately call onAccepted - no need to wait or show alert
        // The user experience is instant and smooth
        onAccepted?.()

        // get a new supabase session to ensure the JWT has the latest claims
        await supabaseClient.auth.refreshSession()
      } else {
        throw new Error(result.error || 'Failed to grant access')
      }
    } catch (error: any) {
      console.error('Error accepting terms:', error)
      Alert.alert(
        'Error',
        'Failed to record your acceptance. Please check your connection and try again.\n\n' +
        error.message,
      )
    }
  }

  const onPressCancel = () => {
    const message = isUpdate
      ? "If you don't accept the updated terms, you won't be able to use the app."
      : 'Are you sure you want to cancel? You will need to sign out.'

    Alert.alert(isUpdate ? 'Terms Required' : 'Cancel Registration', message, [
      { text: isUpdate ? 'Review Again' : 'Continue Registration', style: 'cancel' },
      {
        text: isUpdate ? 'Sign Out' : 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          await signOut?.()
          onCanceled?.()
        },
      },
    ])
  }

  const onPressTerms = () => {
    router.push('/terms')
  }

  const onPressPrivacy = () => {
    router.push('/privacy')
  }

  return (
    <View style={styles.container}>
      <Logo />

      <Text style={styles.title}>
        {isUpdate
          ? `Terms Updated (v${TERMS.version})`
          : 'Welcome to Clanker'}
      </Text>

      <View style={styles.separator} />

      <Text style={styles.summaryText}>{TERMS.summary}</Text>

      <View style={styles.buttonRow}>
        <Button mode="outlined" onPress={onPressTerms}>
          View Full Terms
        </Button>
        <Button mode="outlined" onPress={onPressPrivacy}>
          Privacy Policy
        </Button>
      </View>

      <View style={styles.separator} />

      <View style={styles.row}>
        <Checkbox status={checked ? 'checked' : 'unchecked'} onPress={onPressChecked} />
        <Text style={styles.text}>
          I am over 18 years of age and I have read and accept the Terms and Conditions and Privacy
          Policy.
        </Text>
      </View>
      <View style={styles.separatorSmall} />
      <Button mode="contained" disabled={!checked} onPress={onPressAccept}>
        {isUpdate ? 'Accept Updated Terms' : 'I Accept'}
      </Button>
      <Button mode="outlined" onPress={onPressCancel}>
        {isUpdate ? 'Cancel' : 'Sign Out'}
      </Button>
      {/* Use a light status bar on iOS to account for the black space above the modal */}
      <StatusBar style={Platform.OS === 'ios' ? 'light' : 'auto'} />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 20,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
    marginVertical: 10,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 10,
  },
  text: {
    fontSize: 16,
    fontWeight: 'normal',
    flex: 1,
    marginLeft: 8,
  },
  summaryText: {
    fontSize: 14,
    textAlign: 'center',
    marginHorizontal: 20,
    lineHeight: 20,
  },
  separator: {
    marginVertical: 20,
    height: 1,
    width: '80%',
  },
  separatorSmall: {
    marginVertical: 10,
    height: 1,
    width: '80%',
  },
})
