import Button from './Button'
import { Alert, Platform } from 'react-native'
import { makePackagePurchase, type ProductType } from '../utilities/makePackagePurchase'
import { useBootstrapRefresh } from '~/hooks/useBootstrapRefresh'

interface Props {
  onChangeIsLoading: (isLoading: boolean) => void
  productType?: ProductType
}

export default function SubscribeButton({ onChangeIsLoading, productType = 'monthly_20' }: Props) {
  const refreshBootstrap = useBootstrapRefresh()

  const onPressSubscribe = async () => {
    onChangeIsLoading(true)
    try {
      const purchaseResult = await makePackagePurchase(productType)
      if (Platform.OS !== 'web' && purchaseResult != null) {
        refreshBootstrap('purchase')
      }
    } catch (e: any) {
      console.error('❌ SubscribeButton purchase error:', e)
      Alert.alert('Purchase Failed', 'Something went wrong. Please try again.')
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
