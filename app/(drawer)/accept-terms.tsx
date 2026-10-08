import { useEffect } from 'react'
import { StyleSheet, View, Alert } from 'react-native'
import { useLocalSearchParams, router } from 'expo-router'
import { useSelector } from '@xstate/react'

import { AcceptTerms } from '~/components/AcceptTerms'
import { ManualDobPicker } from '~/components/ManualDobPicker'
import { useTermsMachine, useAuthMachine } from '~/hooks/useMachines'
import { useAgeVerification } from '~/hooks/useAgeVerification'
import { TERMS } from '~/config/termsConfig'
import { handleTermsDecline } from '~/utilities/termsDecline'

export default function AcceptTermsScreen() {
  const params = useLocalSearchParams()
  const termsService = useTermsMachine()
  const authService = useAuthMachine()
  const isUpdate = params.isUpdate === 'true'

  const { accepted, declined, accepting, error } = useSelector(termsService, (state) => ({
    accepted: state.matches('accepted'),
    declined: state.matches('declined'),
    accepting: state.matches('accepting'),
    error: state.context.error,
  }))

  useEffect(() => {
    if (accepted) {
      authService.send({
        type: 'TERMS_ACCEPTED_LOCAL',
        termsVersion: TERMS.version,
        termsAcceptedAt: new Date().toISOString(),
      })
      router.replace('/')
    }
  }, [accepted, authService])

  // Decline is NOT an acceptance: re-enter the app without recording the new Terms version
  // (issue #810). Only 'accepted' reaches TERMS_ACCEPTED_LOCAL above.
  useEffect(() => {
    if (declined) {
      router.replace('/')
    }
  }, [declined])

  const handleVerifiedAdult = () => {
    termsService.send({ type: 'ACCEPT_TERMS', isUpdate })
  }

  const handleRejectedMinor = () => {
    Alert.alert('Age Restriction', 'This app is for users 18 and older.')
    authService.send({ type: 'SIGN_OUT' })
  }

  const { verifyAge, isVerifying, showDobPicker, handleDobResult } = useAgeVerification({
    onVerified: handleVerifiedAdult,
    onRejected: handleRejectedMinor,
  })

  useEffect(() => {
    if (showDobPicker && error) {
      Alert.alert(
        'Error',
        `Failed to record your acceptance. Please check your connection and try again.\n\n${error.message}`,
      )
    }
  }, [showDobPicker, error])

  // Decline = notice-then-enforce (ToS §12.19 option [B], issue #810): no sign-out, keep
  // paid access until the decline window ends. Shared with the drawer gate in
  // src/utilities/termsDecline.ts so the window rule and notice copy cannot drift.
  // First-time acceptances (isUpdate=false) have no "previously accepted Terms" to fall
  // back on, so declining there still signs the user out.
  const handleCanceled = () => {
    if (isUpdate) {
      handleTermsDecline(termsService)
    } else {
      authService.send({ type: 'SIGN_OUT' })
    }
  }

  if (showDobPicker) {
    return (
      <View style={styles.container}>
        <ManualDobPicker onComplete={handleDobResult} loading={accepting} />
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <AcceptTerms
        onAccepted={verifyAge}
        onCanceled={handleCanceled}
        isUpdate={isUpdate}
        accepting={accepting || isVerifying}
        error={error?.message}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
})
