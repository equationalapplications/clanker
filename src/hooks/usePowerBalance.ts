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
const AMBER_THRESHOLD = 0.2
const RED_THRESHOLD = 0.05

export function computePowerFill(totalPower: number, grantedPower: number): PowerFill {
  if (grantedPower <= 0) {
    return { rawFill: 0, barFill: 0, band: 'red', isUnknown: true }
  }
  const rawFill = Math.min(totalPower / grantedPower, 1)
  let barFill = Math.round(rawFill * 20) / 20
  if (totalPower > 0 && barFill === 0) {
    barFill = MIN_SLIVER
  }
  const band: PowerBand =
    rawFill >= AMBER_THRESHOLD ? 'normal' : rawFill >= RED_THRESHOLD ? 'amber' : 'red'
  return { rawFill, barFill, band, isUnknown: false }
}

export function usePowerBalance() {
  const { data, isLoading: baseIsLoading } = useUserCredits()
  const { grantedTotal } = useAuthCredits()
  const totalPower = data?.totalCredits ?? 0
  const fill = computePowerFill(totalPower, grantedTotal)
  // grantedTotal === 0 while totalPower > 0 is impossible from the DB query
  // (a positive balance means live rows exist, so their initial_amount sum
  // is > 0) — it can only mean the server-side getGrantedTotal lookup
  // failed or a stale bootstrap cache lacks the field. Treat that as still
  // loading rather than a genuine empty meter, per spec section 5.
  const isLoading = baseIsLoading || (fill.isUnknown && totalPower > 0)
  return {
    totalPower,
    grantedPower: grantedTotal,
    ...fill,
    isLoading,
  }
}
