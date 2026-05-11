import type { ViewStyle } from 'react-native'

import ProviderButton from '~/auth/AuthProviderButton'
import { useAuthMachine } from '~/hooks/useMachines'

type Props = {
  /** Web-only; ignored on native (use auth machine `signingIn` for loading). */
  onLoadingChange?: (loading: boolean) => void
  disabled?: boolean
  style?: ViewStyle
}

export default function GoogleSignInButton({ disabled, style }: Props) {
  const authService = useAuthMachine()

  const onPress = () => {
    authService.send({ type: 'SIGN_IN', provider: 'google' })
  }

  return (
    <ProviderButton style={style} type="google" onPress={onPress} disabled={disabled}>
      Google
    </ProviderButton>
  )
}
