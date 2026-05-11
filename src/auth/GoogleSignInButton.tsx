import type { ViewStyle } from 'react-native'

import ProviderButton from '~/auth/AuthProviderButton'
import { useAuthMachine } from '~/hooks/useMachines'

type Props = {
  /** FedCM credential exchange (web only); native ignores. */
  onLoadingChange?: (loading: boolean) => void
  /** Auth machine busy states (initializing / signingIn / bootstrapping). */
  loading?: boolean
  disabled?: boolean
  style?: ViewStyle
}

export default function GoogleSignInButton({ disabled, loading, style }: Props) {
  const authService = useAuthMachine()

  const onPress = () => {
    authService.send({ type: 'SIGN_IN', provider: 'google' })
  }

  return (
    <ProviderButton
      style={style}
      type="google"
      onPress={onPress}
      disabled={disabled}
      loading={loading}
    >
      Google
    </ProviderButton>
  )
}
