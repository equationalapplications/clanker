import Button from '../components/Button'
import { makePackagePurchase } from '../utilities/makePackagePurchase'

interface Props {
  onChangeIsLoading: (isLoading: boolean) => void
}

export default function SubscribeButton({ onChangeIsLoading }: Props) {
  const onPressSubscribe = async () => {
    onChangeIsLoading(true)
    await makePackagePurchase()
    onChangeIsLoading(false)
  }

  return (
    <Button onPress={onPressSubscribe} mode="outlined">
      Subscribe Now!
    </Button>
  )
}
