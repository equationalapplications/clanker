import { useIsPremium } from "../hooks/useIsPremium"
import SubscribeButton from "./SubscribeButton"
import SubscriptionInfoButton from "./SubscriptionInfoButton"

export default function CombinedSubscriptionButton({ onChangeIsLoading }) {
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
