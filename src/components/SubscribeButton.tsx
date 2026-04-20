import Button from './Button'
import { Platform } from 'react-native'
import { makePackagePurchase, type ProductType } from '../utilities/makePackagePurchase'
import { useAuthMachine } from '~/hooks/useMachines'

interface Props {
  onChangeIsLoading: (isLoading: boolean) => void
  productType?: ProductType
}

export default function SubscribeButton({ onChangeIsLoading, productType = 'monthly_20' }: Props) {
  const authService = useAuthMachine()

  const onPressSubscribe = async () => {
    onChangeIsLoading(true)
    try {
      await makePackagePurchase(productType)
      if (Platform.OS !== 'web') {
        authService.send({ type: 'REFRESH_BOOTSTRAP' })
      }
    } finally {
      onChangeIsLoading(false)
    }
  }

  return (
    <Button onPress={onPressSubscribe} mode="outlined">
      Subscribe Now!
    </Button>
  )
}
