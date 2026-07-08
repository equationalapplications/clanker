import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'expo-router'
import { Banner } from 'react-native-paper'
import { usePowerBalance } from '~/hooks/usePowerBalance'

let amberShownThisSession = false
export function resetLowPowerSession() {
  amberShownThisSession = false
}

export function LowPowerBanner() {
  const router = useRouter()
  const { band, isLoading } = usePowerBalance()
  const [dismissed, setDismissed] = useState(false)
  const [amberLatched, setAmberLatched] = useState(amberShownThisSession)
  const hasShownAmberRef = useRef(amberShownThisSession)

  useEffect(() => {
    if (band === 'amber' && !hasShownAmberRef.current) {
      hasShownAmberRef.current = true
      amberShownThisSession = true
      setAmberLatched(true)
    }
  }, [band])

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

  if (band === 'amber' && amberLatched) {
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
