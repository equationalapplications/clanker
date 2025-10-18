import { StyleSheet, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { AcceptTerms } from '~/components/AcceptTerms'
import { useSubscriptionStatus } from '~/hooks/useSubscriptionStatus'

export default function AcceptTermsScreen() {
  const params = useLocalSearchParams()
  const { markTermsAccepted } = useSubscriptionStatus()
  const isUpdate = params.isUpdate === 'true'

  const handleAccepted = () => {
    console.log('[AcceptTermsScreen] handleAccepted called')

    // Optimistically mark terms as accepted in local state
    // This allows instant navigation without waiting for JWT refresh
    console.log('[AcceptTermsScreen] Marking terms as accepted in Context')
    markTermsAccepted()

    console.log('[AcceptTermsScreen] Navigating to root /')
    // Navigate back - the app will now see terms as accepted
    router.replace('/')
  }

  const handleCanceled = () => {
    // User canceled/signed out, go back to sign-in
    router.replace('/sign-in')
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
