import React from 'react'
import { act, create } from 'react-test-renderer'

const mockMakePackagePurchase = jest.fn()

jest.mock('~/utilities/makePackagePurchase', () => ({
  makePackagePurchase: (...args: unknown[]) => mockMakePackagePurchase(...args),
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
})
