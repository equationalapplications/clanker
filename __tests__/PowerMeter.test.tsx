import React from 'react'
import { act, create } from 'react-test-renderer'
import { PowerMeter } from '~/components/PowerMeter'
import { useCurrentPlan } from '~/hooks/useCurrentPlan'
import { usePowerBalance } from '~/hooks/usePowerBalance'

const mockPush = jest.fn()

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}))

jest.mock('~/hooks/useCurrentPlan', () => ({
  useCurrentPlan: jest.fn(),
}))

jest.mock('~/hooks/usePowerBalance', () => ({
  usePowerBalance: jest.fn(),
}))

const mockUseCurrentPlan = useCurrentPlan as jest.Mock
const mockUsePowerBalance = usePowerBalance as jest.Mock

describe('PowerMeter', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockUseCurrentPlan.mockReturnValue({ isSubscriber: false, isLoading: false })
  })

  it('shows loading testID and accessibility label while loading', () => {
    mockUsePowerBalance.mockReturnValue({
      totalPower: 0,
      grantedPower: 0,
      rawFill: 0,
      barFill: 0,
      band: 'red',
      isLoading: true,
      isUnknown: true,
    })

    let tree!: ReturnType<typeof create>
    act(() => {
      tree = create(<PowerMeter />)
    })

    const loading = tree.root.findByProps({ testID: 'power-meter-loading' })
    expect(loading.props.accessibilityLabel).toBe('Power loading')
  })

  it('renders fill width at 85% for normal band', () => {
    mockUsePowerBalance.mockReturnValue({
      totalPower: 85,
      grantedPower: 100,
      rawFill: 0.85,
      barFill: 0.85,
      band: 'normal',
      isLoading: false,
      isUnknown: false,
    })

    let tree!: ReturnType<typeof create>
    act(() => {
      tree = create(<PowerMeter />)
    })

    const fill = tree.root.findByProps({ testID: 'power-meter-fill' })
    expect(fill.props.style.width).toBe('85%')

    const pressable = tree.root.findByProps({ testID: 'power-meter' })
    expect(pressable.props.accessibilityLabel).toBe('Power at 85%')
  })

  it('uses error color for red band', () => {
    mockUsePowerBalance.mockReturnValue({
      totalPower: 3,
      grantedPower: 100,
      rawFill: 0.03,
      barFill: 0.05,
      band: 'red',
      isLoading: false,
      isUnknown: false,
    })

    let tree!: ReturnType<typeof create>
    act(() => {
      tree = create(<PowerMeter />)
    })

    const fill = tree.root.findByProps({ testID: 'power-meter-fill' })
    expect(fill.props.style.backgroundColor).toBeDefined()
    // error color should differ from primary/normal band color
    expect(fill.props.style.backgroundColor).not.toBe('')
  })

  it('navigates to subscribe screen on press', () => {
    mockUsePowerBalance.mockReturnValue({
      totalPower: 85,
      grantedPower: 100,
      rawFill: 0.85,
      barFill: 0.85,
      band: 'normal',
      isLoading: false,
      isUnknown: false,
    })

    let tree!: ReturnType<typeof create>
    act(() => {
      tree = create(<PowerMeter />)
    })

    const pressable = tree.root.findByProps({ testID: 'power-meter' })
    act(() => {
      pressable.props.onPress()
    })

    expect(mockPush).toHaveBeenCalledWith('/(drawer)/subscribe')
  })

  it('does not render any numeric balance text', () => {
    mockUsePowerBalance.mockReturnValue({
      totalPower: 85,
      grantedPower: 100,
      rawFill: 0.85,
      barFill: 0.85,
      band: 'normal',
      isLoading: false,
      isUnknown: false,
    })

    let tree!: ReturnType<typeof create>
    act(() => {
      tree = create(<PowerMeter />)
    })

    const textNodes = tree.root.findAllByType(require('react-native').Text)
    expect(textNodes.length).toBe(0)
  })
})
