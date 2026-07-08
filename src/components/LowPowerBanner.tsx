import { useState } from 'react'
import { useRouter } from 'expo-router'
import { Banner } from 'react-native-paper'
import { usePowerBalance } from '~/hooks/usePowerBalance'

let amberShownThisSession = false
export function resetLowPowerSession() {
  amberShownThisSession = false
}

export function LowPowerBanner() {
  const router = typeof useRouter === 'function' ? useRouter() : null
  const { band, isLoading } = usePowerBalance()
  const [dismissed, setDismissed] = useState(false)

  const navigateToSubscribe = () => {
    router?.push?.('/(drawer)/subscribe')
  }

  if (isLoading || dismissed) return null

  if (band === 'red') {
    return (
      <Banner
        visible
        actions={[{ label: 'Recharge', onPress: navigateToSubscribe }]}
      >
        Low Power — recharge to keep chatting.
      </Banner>
    )
  }

  if (band === 'amber' && !amberShownThisSession) {
    amberShownThisSession = true
    return (
      <Banner
        visible
        actions={[
          { label: 'Recharge', onPress: navigateToSubscribe },
          { label: 'Dismiss', onPress: () => setDismissed(true) },
        ]}
      >
        Power getting low.
      </Banner>
    )
  }

  return null
}
