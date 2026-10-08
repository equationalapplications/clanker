import { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import { router } from 'expo-router'
import { useSelector } from '@xstate/react'

import { AcceptTerms } from '~/components/AcceptTerms'
import { ManualDobPicker } from '~/components/ManualDobPicker'
import { useTermsMachine, useAuthMachine } from '~/hooks/useMachines'
import { useAgeVerification } from '~/hooks/useAgeVerification'
import { showAlert } from '~/utilities/showAlert'
import { TERMS } from '~/config/termsConfig'
import { handleTermsCanceled } from '~/utilities/termsDecline'

export default function AcceptTermsScreen() {
  const termsService = useTermsMachine()
  const authService = useAuthMachine()
  // From the machine context, NOT search params (finding: a deep link could pass a crafted
  // ?isUpdate=true on a first-run account — or drop it during an update prompt — and the
  // two decline surfaces would disagree with the drawer gate's machine-derived value).
  const { accepted, declined, accepting, isUpdate, error } = useSelector(termsService, (state) => ({
    accepted: state.matches('accepted'),
    declined: state.matches('declined'),
    accepting: state.matches('accepting'),
    isUpdate: state.context.isUpdate,
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
    showAlert('Age Restriction', 'This app is for users 18 and older.')
    authService.send({ type: 'SIGN_OUT' })
  }

  const { verifyAge, isVerifying, showDobPicker, handleDobResult } = useAgeVerification({
    onVerified: handleVerifiedAdult,
    onRejected: handleRejectedMinor,
  })

  useEffect(() => {
    if (showDobPicker && error) {
      showAlert(
        'Error',
        `Failed to record your acceptance. Please check your connection and try again.\n\n${error.message}`,
      )
    }
  }, [showDobPicker, error])

  // Decline vs sign-out policy shared with the drawer gate in
  // src/utilities/termsDecline.ts so the rule cannot drift between callers.
  const handleCanceled = () => handleTermsCanceled(termsService, authService)

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
