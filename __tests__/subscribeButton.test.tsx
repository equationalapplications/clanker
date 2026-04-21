import React from 'react'
import { act, create } from 'react-test-renderer'

let mockPlatformOS: 'web' | 'ios' | 'android' = 'web'
const mockMakePackagePurchase = jest.fn()
const mockAuthSend = jest.fn()
const mockInvalidateQueries = jest.fn()

jest.mock('react-native', () => {
  const React = require('react')

  return {
    Pressable: ({ children, onPress, ...props }: any) =>
      React.createElement('Pressable', { onPress, ...props }, children),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    Platform: {
      get OS() {
        return mockPlatformOS
      },
    },
  }
})

jest.mock('~/utilities/makePackagePurchase', () => ({
  makePackagePurchase: (...args: unknown[]) => mockMakePackagePurchase(...args),
}))

jest.mock('~/hooks/useMachines', () => ({
  useAuthMachine: () => ({
    send: (...args: unknown[]) => mockAuthSend(...args),
  }),
}))

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: (...args: unknown[]) => mockInvalidateQueries(...args),
  }),
}))

jest.mock('~/components/Button', () => {
  const React = require('react')
  const { Pressable, Text: RNText } = require('react-native')

  return ({ children, onPress, ...props }: any) => (
    <Pressable testID="subscribe-button" onPress={onPress} {...props}>
      <RNText>{children}</RNText>
    </Pressable>
  )
})

describe('SubscribeButton', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockPlatformOS = 'web'
  })

  it('toggles loading state around successful purchase', async () => {
    const onChangeIsLoading = jest.fn()
    mockMakePackagePurchase.mockResolvedValueOnce(undefined)

    const SubscribeButton = require('~/components/SubscribeButton').default
    let tree!: ReturnType<typeof create>

    await act(async () => {
      tree = create(<SubscribeButton onChangeIsLoading={onChangeIsLoading} productType="monthly_50" />)
    })

    const button = tree.root.findByProps({ testID: 'subscribe-button' })

    await act(async () => {
      await button.props.onPress()
    })

    expect(mockMakePackagePurchase).toHaveBeenCalledWith('monthly_50')
    expect(onChangeIsLoading).toHaveBeenNthCalledWith(1, true)
    expect(onChangeIsLoading).toHaveBeenNthCalledWith(2, false)
  })

  it('always clears loading state when purchase throws', async () => {
    const onChangeIsLoading = jest.fn()
    mockMakePackagePurchase.mockRejectedValueOnce(new Error('purchase failed'))

    const SubscribeButton = require('~/components/SubscribeButton').default
    let tree!: ReturnType<typeof create>

    await act(async () => {
      tree = create(<SubscribeButton onChangeIsLoading={onChangeIsLoading} />)
    })

    const button = tree.root.findByProps({ testID: 'subscribe-button' })

    await expect(
      act(async () => {
        await button.props.onPress()
      }),
    ).rejects.toThrow('purchase failed')

    expect(mockMakePackagePurchase).toHaveBeenCalledWith('monthly_20')
    expect(onChangeIsLoading).toHaveBeenNthCalledWith(1, true)
    expect(onChangeIsLoading).toHaveBeenNthCalledWith(2, false)
  })

  it('refreshes bootstrap state and invalidates credits query after native purchase', async () => {
    mockPlatformOS = 'ios'
    const onChangeIsLoading = jest.fn()
    mockMakePackagePurchase.mockResolvedValueOnce(undefined)

    const SubscribeButton = require('~/components/SubscribeButton').default
    let tree!: ReturnType<typeof create>

    await act(async () => {
      tree = create(<SubscribeButton onChangeIsLoading={onChangeIsLoading} productType="monthly_20" />)
    })

    const button = tree.root.findByProps({ testID: 'subscribe-button' })

    await act(async () => {
      await button.props.onPress()
    })

    expect(mockAuthSend).toHaveBeenCalledWith({ type: 'REFRESH_BOOTSTRAP' })
    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['userCredits'] })
  })
})
