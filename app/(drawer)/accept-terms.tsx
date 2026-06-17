import { useEffect } from 'react'
import { StyleSheet, View, Alert } from 'react-native'
import { useLocalSearchParams, router } from 'expo-router'
import { useSelector } from '@xstate/react'

import { AcceptTerms } from '~/components/AcceptTerms'
import { ManualDobPicker } from '~/components/ManualDobPicker'
import { useTermsMachine, useAuthMachine } from '~/hooks/useMachines'
import { useAgeVerification } from '~/hooks/useAgeVerification'
import { TERMS } from '~/config/termsConfig'

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

  const handleCanceled = () => {
    authService.send({ type: 'SIGN_OUT' })
  }

  if (showDobPicker) {
    return (
      <View style={styles.container}>
        <ManualDobPicker onComplete={handleDobResult} />
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
