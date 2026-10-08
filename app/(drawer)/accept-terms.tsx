import { useEffect } from 'react'
import { StyleSheet, View, Alert } from 'react-native'
import { useLocalSearchParams, router } from 'expo-router'
import { useSelector } from '@xstate/react'

import { showAlert } from '~/utilities/showAlert'
import { AcceptTerms } from '~/components/AcceptTerms'
import { ManualDobPicker } from '~/components/ManualDobPicker'
import { useTermsMachine, useAuthMachine } from '~/hooks/useMachines'
import { useAgeVerification } from '~/hooks/useAgeVerification'
import { TERMS } from '~/config/termsConfig'
import { recordTermsDecline } from '~/machines/termsMachine'

export default function AcceptTermsScreen() {
  const params = useLocalSearchParams()
  const termsService = useTermsMachine()
  const authService = useAuthMachine()
  const isUpdate = params.isUpdate === 'true'

  const { accepted, accepting, error } = useSelector(termsService, (state) => ({
    accepted: state.matches('accepted'),
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

  const handleCanceled = () => {
    // Decline = notice-then-enforce (ToS §12.19 option [B], issue #810): no sign-out, keep
    // paid access; blocking resumes at the next acceptance check after the decline window.
    const subscription = termsService.getSnapshot().context.subscription
    const periodEnd = subscription?.nextExpiryDate ?? null
    const now = new Date()
    const parsed = periodEnd ? Date.parse(periodEnd) : NaN
    const windowEnd =
      !Number.isNaN(parsed) && parsed > now.getTime()
        ? (periodEnd as string)
        : new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString()
    recordTermsDecline(windowEnd, now)
    termsService.send({ type: 'DECLINE_TERMS' })
    showAlert(
      'Terms declined',
      "You can keep using Clanker under the previous Terms until the end of the period you've already paid for. Your next renewal requires accepting the updated Terms — you can also cancel before renewal in your account or store settings.",
    )
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
