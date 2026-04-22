import Button from './Button'
import { Alert, Platform } from 'react-native'
import { makePackagePurchase, type ProductType } from '../utilities/makePackagePurchase'
import { useBootstrapRefresh } from '~/hooks/useBootstrapRefresh'

interface Props {
  onChangeIsLoading: (isLoading: boolean) => void
  productType?: ProductType
}

function getPurchaseFailureAlertMessage(error: unknown): string {
  const fallbackMessage = 'Something went wrong. Please try again.'
  const isDevBuild = typeof __DEV__ === 'boolean' ? __DEV__ : process.env.NODE_ENV !== 'production'

  if (!isDevBuild) {
    return fallbackMessage
  }

  const detailMessage =
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as { message?: unknown }).message === 'string'
      ? (error as { message: string }).message.trim()
      : ''

  if (!detailMessage) {
    return fallbackMessage
  }

  return `${fallbackMessage}\n\nDetails: ${detailMessage}`
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
    } catch (e: unknown) {
      console.error('❌ SubscribeButton purchase error:', e)
      Alert.alert('Purchase Failed', getPurchaseFailureAlertMessage(e))
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
