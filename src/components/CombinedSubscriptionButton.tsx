import SubscribeButton from '~/components/SubscribeButton'
import SubscriptionInfoButton from '~/components/SubscriptionInfoButton'
import { useIsPremium } from '~/hooks/useIsPremium'

interface Props {
  onChangeIsLoading: (isLoading: boolean) => void
}

export default function CombinedSubscriptionButton({ onChangeIsLoading }: Props) {
  const isPremium = useIsPremium()
  return (
    <>
      {isPremium ? (
        <SubscriptionInfoButton onChangeIsLoading={onChangeIsLoading} />
      ) : (
        <SubscribeButton onChangeIsLoading={onChangeIsLoading} />
      )}
    </>
  )
}
