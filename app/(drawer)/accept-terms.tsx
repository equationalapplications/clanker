import { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import { useLocalSearchParams, router } from 'expo-router'
import { useSelector } from '@xstate/react'
import { AcceptTerms } from '~/components/AcceptTerms'
import { useTermsMachine, useAuthMachine } from '~/hooks/useMachines'

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
      authService.send({ type: 'REFRESH_BOOTSTRAP' })
      router.replace('/')
    }
  }, [accepted, authService])

  const handleAccepted = () => {
    termsService.send({ type: 'ACCEPT_TERMS', isUpdate })
  }

  const handleCanceled = () => {
    authService.send({ type: 'SIGN_OUT' })
  }

  return (
    <View style={styles.container}>
      <AcceptTerms
        onAccepted={handleAccepted}
        onCanceled={handleCanceled}
        isUpdate={isUpdate}
        accepting={accepting}
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
