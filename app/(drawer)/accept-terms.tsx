import { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import { useLocalSearchParams, router } from 'expo-router'
import { useSelector } from '@xstate/react'
import { AcceptTerms } from '~/components/AcceptTerms'
import { useTermsMachine , useAuthMachine } from '~/hooks/useMachines'

export default function AcceptTermsScreen() {
  const params = useLocalSearchParams()
  const termsService = useTermsMachine();
  const authService = useAuthMachine();
  const isUpdate = params.isUpdate === 'true'

  const accepted = useSelector(termsService, (state) => state.matches('accepted'));

  useEffect(() => {
    if (accepted) {
      router.replace('/')
    }
  }, [accepted])

  const handleAccepted = () => {
    termsService.send({ type: 'ACCEPT_TERMS', isUpdate });
  }

  const handleCanceled = () => {
    authService.send({ type: 'SIGN_OUT' });
  }

  return (
    <View style={styles.container}>
      <AcceptTerms onAccepted={handleAccepted} onCanceled={handleCanceled} isUpdate={isUpdate} />
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
