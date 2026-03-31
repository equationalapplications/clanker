import { useCurrentPlan } from '~/hooks/useCurrentPlan'

export const useIsPremium = (): boolean => {
  const { isSubscriber } = useCurrentPlan()
  return isSubscriber
}
