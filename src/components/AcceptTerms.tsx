import { StatusBar } from 'expo-status-bar'
import { useState, useEffect } from 'react'
import { StyleSheet, View, Alert, Platform } from 'react-native'
import { Text, Checkbox, useTheme } from 'react-native-paper'
import { router } from 'expo-router'
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller'

import Button from '~/components/Button'
import Logo from '~/components/Logo'
import { TERMS } from '~/config/termsConfig'

interface AcceptTermsProps {
  onAccepted?: () => void
  onCanceled?: () => void
  isUpdate?: boolean
  accepting?: boolean
  error?: string | null
}

export function AcceptTerms({
  onAccepted,
  onCanceled,
  isUpdate = false,
  accepting = false,
  error = null,
}: AcceptTermsProps) {
  const [checked, setChecked] = useState(false)
  const { colors } = useTheme()

  useEffect(() => {
    if (error) {
      Alert.alert(
        'Error',
        `Failed to record your acceptance. Please check your connection and try again.\n\n${error}`,
      )
    }
  }, [error])

  const onPressChecked = () => {
    setChecked(!checked)
  }

  const onPressAccept = () => {
    if (!checked) {
      Alert.alert('Please Accept Terms', 'You must accept the terms and conditions to continue.')
      return
    }
    onAccepted?.()
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
        onPress: () => {
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
    <KeyboardAwareScrollView
      contentContainerStyle={styles.scrollContent}
      style={styles.container}
      bounces={false}
      bottomOffset={20}
    >
      <Logo />

      <Text style={styles.title}>
        {isUpdate ? `Terms Updated (v${TERMS.version})` : 'Welcome to Clanker'}
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
        <View
          style={[
            styles.checkboxContainer,
            {
              borderColor: colors.onBackground,
              backgroundColor: colors.surfaceVariant,
            },
          ]}
        >
          <Checkbox
            status={checked ? 'checked' : 'unchecked'}
            onPress={onPressChecked}
            color={colors.primary}
            uncheckedColor={colors.onBackground}
            style={styles.checkbox}
          />
        </View>
        <Text style={styles.text}>
          I am over 18 years of age and I have read and accept the Terms and Conditions and Privacy
          Policy.
        </Text>
      </View>
      <View style={styles.separatorSmall} />
      <Button
        mode="contained"
        disabled={!checked || accepting}
        loading={accepting}
        onPress={onPressAccept}
      >
        {isUpdate ? 'Accept Updated Terms' : 'I Accept'}
      </Button>
      <Button mode="outlined" onPress={onPressCancel}>
        {isUpdate ? 'Cancel' : 'Sign Out'}
      </Button>
      {/* Use a light status bar on iOS to account for the black space above the modal */}
      <StatusBar style={Platform.OS === 'ios' ? 'light' : 'auto'} />
    </KeyboardAwareScrollView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 40,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxContainer: {
    borderWidth: 2,
    borderRadius: 8,
    marginRight: 4,
  },
  checkbox: {
    margin: 0,
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
