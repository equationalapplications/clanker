import { useIsPremium } from "../hooks/useIsPremium"
import SubscribeButton from "./SubscribeButton"
import SubscriptionInfoButton from "./SubscriptionInfoButton"

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
