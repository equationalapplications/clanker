import { StatusBar } from "expo-status-bar"
import { useState } from "react"
import { StyleSheet, View, Alert } from "react-native"
import { Text, Checkbox } from "react-native-paper"

import Button from "./Button"
import LoadingIndicator from "./LoadingIndicator"
import Logo from "./Logo"
import { platform } from "../config/constants"
import { grantAppAccess } from "../utilities/appAccess"

interface AcceptTermsProps {
  onAccepted?: () => void
  onCanceled?: () => void
  termsVersion?: string
}

export function AcceptTerms({ onAccepted, onCanceled, termsVersion = '1.0' }: AcceptTermsProps) {
  const [checked, setChecked] = useState(false)
  const [loading, setLoading] = useState(false)

  const onPressChecked = () => {
    setChecked(!checked)
  }

  const onPressAccept = async () => {
    if (!checked) {
      Alert.alert('Please Accept Terms', 'You must accept the terms and conditions to continue.')
      return
    }

    setLoading(true)

    try {
      console.log('Accepting terms and granting app access...')
      const result = await grantAppAccess('yours-brightly', termsVersion)

      if (result.success) {
        console.log('Terms accepted successfully')
        Alert.alert(
          'Welcome!',
          'Terms accepted successfully. You now have access to Yours Brightly AI with 50 free credits.',
          [{ text: 'Continue', onPress: onAccepted }]
        )
      } else {
        throw new Error(result.error || 'Failed to grant access')
      }
    } catch (error: any) {
      console.error('Error accepting terms:', error)
      Alert.alert(
        'Error',
        'Failed to accept terms. Please try again.\n\n' + error.message
      )
    } finally {
      setLoading(false)
    }
  }

  const onPressCancel = () => {
    Alert.alert(
      'Cancel Registration',
      'Are you sure you want to cancel? You will need to sign out.',
      [
        { text: 'Continue Registration', style: 'cancel' },
        { text: 'Sign Out', style: 'destructive', onPress: onCanceled }
      ]
    )
  }

  const onPressTerms = () => {
    // TODO: Navigate to terms page when implemented
    Alert.alert('Terms', 'Terms and Conditions page will be implemented soon.')
  }

  const onPressPrivacy = () => {
    // TODO: Navigate to privacy page when implemented  
    Alert.alert('Privacy', 'Privacy Policy page will be implemented soon.')
  }

  return (
    <View style={styles.container}>
      {loading ? (
        <LoadingIndicator />
      ) : (
        <>
          <Logo />
          <Button onPress={onPressTerms}>Terms of Service</Button>
          <Button onPress={onPressPrivacy}>Privacy Policy</Button>
          <View style={styles.row}>
            <Checkbox status={checked ? "checked" : "unchecked"} onPress={onPressChecked} />
            <Text style={styles.text}>
              I am over 18 years of age and I have read and accept the Terms and Conditions and
              Privacy Policy.
            </Text>
          </View>
          <View style={styles.separatorSmall} />
          <Button mode="contained" disabled={!checked} onPress={onPressAccept}>
            I accept
          </Button>
          <Button mode="contained" onPress={onPressCancel}>
            Cancel
          </Button>
        </>
      )}

      {/* Use a light status bar on iOS to account for the black space above the modal */}
      <StatusBar style={platform === "ios" ? "light" : "auto"} />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: 20,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 20,
    fontWeight: "bold",
  },
  text: {
    fontSize: 16,
    fontWeight: "normal",
  },
  separator: {
    marginVertical: 30,
    height: 1,
    width: "80%",
  },
  separatorSmall: {
    marginVertical: 10,
    height: 1,
    width: "80%",
  },
})
