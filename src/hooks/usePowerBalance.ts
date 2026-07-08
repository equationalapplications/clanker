import { useUserCredits } from '~/hooks/useUserCredits'
import { useAuthCredits } from '~/hooks/useAuthSnapshot'

export type PowerBand = 'normal' | 'amber' | 'red'

export interface PowerFill {
  rawFill: number
  barFill: number
  band: PowerBand
  isUnknown: boolean
}

const MIN_SLIVER = 0.03

export function computePowerFill(totalPower: number, grantedPower: number): PowerFill {
  if (grantedPower <= 0) {
    return { rawFill: 0, barFill: 0, band: 'red', isUnknown: true }
  }
  const rawFill = Math.min(totalPower / grantedPower, 1)
  let barFill = Math.round(rawFill * 20) / 20
  if (totalPower > 0 && barFill === 0) {
    barFill = MIN_SLIVER
  }
  const band: PowerBand = rawFill >= 0.2 ? 'normal' : rawFill >= 0.05 ? 'amber' : 'red'
  return { rawFill, barFill, band, isUnknown: false }
}

export function usePowerBalance() {
  const { data, isLoading } = useUserCredits()
  const { grantedTotal } = useAuthCredits()
  const totalPower = data?.totalCredits ?? 0
  const fill = computePowerFill(totalPower, grantedTotal)
  return {
    totalPower,
    grantedPower: grantedTotal,
    ...fill,
    isLoading: isLoading || fill.isUnknown,
  }
}
