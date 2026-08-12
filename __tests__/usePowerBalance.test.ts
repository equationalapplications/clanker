import { computePowerFill } from '~/hooks/usePowerBalance'

describe('computePowerFill', () => {
  it('quantizes bar to 5% steps', () => expect(computePowerFill(15100, 30000).barFill).toBe(0.5))
  it('keeps minimum sliver when balance > 0 rounds to 0', () =>
    expect(computePowerFill(100, 5000).barFill).toBe(0.03))
  it('renders empty at zero balance', () => expect(computePowerFill(0, 5000).barFill).toBe(0))
  it('bands use raw ratio, not quantized', () => {
    expect(computePowerFill(1100, 30000).band).toBe('red') // 3.7%
    expect(computePowerFill(4000, 30000).band).toBe('amber') // 13.3%
    expect(computePowerFill(20000, 30000).band).toBe('normal')
  })
  it('full at grant', () => expect(computePowerFill(30000, 30000).barFill).toBe(1))
  it('unknown capacity yields loading state', () =>
    expect(computePowerFill(5000, 0).isUnknown).toBe(true))
})
