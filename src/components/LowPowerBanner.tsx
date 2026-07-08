import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'expo-router'
import { Banner } from 'react-native-paper'
import { usePowerBalance } from '~/hooks/usePowerBalance'
import { getAmberShownThisSession, setAmberShownThisSession } from '~/state/lowPowerSession'

export { resetLowPowerSession } from '~/state/lowPowerSession'

export function LowPowerBanner() {
  const router = useRouter()
  const { band, isLoading } = usePowerBalance()
  const [dismissed, setDismissed] = useState(false)
  const [amberLatched, setAmberLatched] = useState(false)
  const hasShownAmberRef = useRef(getAmberShownThisSession())

  useEffect(() => {
    if (band === 'amber' && !hasShownAmberRef.current) {
      hasShownAmberRef.current = true
      setAmberShownThisSession()
      setAmberLatched(true)
      return
    }
    if (band !== 'amber') {
      setAmberLatched(false)
    }
  }, [band])

  const navigateToSubscribe = () => {
    router?.push?.('/(drawer)/subscribe')
  }

  if (isLoading) return null

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

  if (dismissed) return null

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
