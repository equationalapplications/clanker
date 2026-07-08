import { useRef, useState } from 'react'
import { useRouter } from 'expo-router'
import { Banner } from 'react-native-paper'
import { usePowerBalance } from '~/hooks/usePowerBalance'

let amberShownThisSession = false
export function resetLowPowerSession() { amberShownThisSession = false }

export function LowPowerBanner() {
  const router = useRouter()
  const { band, isLoading } = usePowerBalance()
  const [dismissed, setDismissed] = useState(false)
  const amberEligible = useRef(!amberShownThisSession)

  if (isLoading || dismissed) return null

  if (band === 'red') {
    return (
      <Banner
        visible
        actions={[{ label: 'Recharge', onPress: () => router.push('/(drawer)/subscribe') }]}
      >
        Low Power — recharge to keep chatting.
      </Banner>
    )
  }

  if (band === 'amber' && amberEligible.current) {
    amberShownThisSession = true
    return (
      <Banner
        visible
        actions={[
          { label: 'Recharge', onPress: () => router.push('/(drawer)/subscribe') },
          { label: 'Dismiss', onPress: () => setDismissed(true) },
        ]}
      >
        Power getting low.
      </Banner>
    )
  }

  return null
}
