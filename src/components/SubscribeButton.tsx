import Button from './Button'
import { Platform } from 'react-native'
import { useQueryClient } from '@tanstack/react-query'
import { makePackagePurchase, type ProductType } from '../utilities/makePackagePurchase'
import { useAuthMachine } from '~/hooks/useMachines'

interface Props {
  onChangeIsLoading: (isLoading: boolean) => void
  productType?: ProductType
}

export default function SubscribeButton({ onChangeIsLoading, productType = 'monthly_20' }: Props) {
  const authService = useAuthMachine()
  const queryClient = useQueryClient()

  const onPressSubscribe = async () => {
    onChangeIsLoading(true)
    try {
      const purchaseResult = await makePackagePurchase(productType)
      if (Platform.OS !== 'web' && purchaseResult != null) {
        authService.send({ type: 'REFRESH_BOOTSTRAP' })
        await queryClient.invalidateQueries({ queryKey: ['userCredits'] })
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
