import Button from './Button'
import { makePackagePurchase, type ProductType } from '../utilities/makePackagePurchase'

interface Props {
  onChangeIsLoading: (isLoading: boolean) => void
  productType?: ProductType
}

export default function SubscribeButton({ onChangeIsLoading, productType = 'monthly_20' }: Props) {
  const onPressSubscribe = async () => {
    onChangeIsLoading(true)
    try {
      await makePackagePurchase(productType)
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
