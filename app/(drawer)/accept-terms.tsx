import { StyleSheet, View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { AcceptTerms } from '~/components/AcceptTerms'
import { useTermsMachine } from '~/hooks/useMachines'
import { useAuthMachine } from '~/hooks/useMachines'

export default function AcceptTermsScreen() {
  const params = useLocalSearchParams()
  const termsService = useTermsMachine();
  const authService = useAuthMachine();
  const isUpdate = params.isUpdate === 'true'

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
