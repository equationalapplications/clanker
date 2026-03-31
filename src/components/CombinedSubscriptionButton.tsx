import SubscribeButton from '~/components/SubscribeButton'
import SubscriptionInfoButton from '~/components/SubscriptionInfoButton'
import { useCurrentPlan } from '~/hooks/useCurrentPlan'

interface Props {
  onChangeIsLoading: (isLoading: boolean) => void
}

export default function CombinedSubscriptionButton({ onChangeIsLoading }: Props) {
  const { isSubscriber } = useCurrentPlan()
  return (
    <>
      {isSubscriber ? (
        <SubscriptionInfoButton onChangeIsLoading={onChangeIsLoading} />
      ) : (
        <SubscribeButton onChangeIsLoading={onChangeIsLoading} />
      )}
    </>
  )
}
