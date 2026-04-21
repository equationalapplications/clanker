import React from 'react'
import { act, create } from 'react-test-renderer'

const mockReplace = jest.fn()
const mockRefreshBootstrap = jest.fn()

jest.mock('expo-router', () => ({
    useRouter: () => ({ replace: mockReplace }),
}))

jest.mock('~/hooks/useBootstrapRefresh', () => ({
    useBootstrapRefresh: () => (...args: unknown[]) => mockRefreshBootstrap(...args),
}))

jest.mock('react-native-paper', () => {
    const React = require('react')
    const { Pressable, Text: RNText } = require('react-native')

    return {
        Text: ({ children, ...props }: any) => <RNText {...props}>{children}</RNText>,
        Button: ({ children, onPress, ...props }: any) => (
            <Pressable testID={props.testID ?? 'checkout-success-button'} onPress={onPress} {...props}>
                <RNText>{children}</RNText>
            </Pressable>
        ),
    }
})

describe('Checkout success refresh behavior', () => {
    beforeEach(() => {
        jest.useFakeTimers()
        jest.clearAllMocks()
    })

    afterEach(() => {
        jest.useRealTimers()
    })

    it('uses only auth bootstrap refresh on timer redirect path', async () => {
        const CheckoutSuccess = require('../app/checkout/success').default

        await act(async () => {
            create(<CheckoutSuccess />)
        })

        await act(async () => {
            jest.advanceTimersByTime(3000)
        })

        expect(mockRefreshBootstrap).toHaveBeenCalledWith('purchase')
        expect(mockReplace).toHaveBeenCalledWith('/')
    })

    it('uses only auth bootstrap refresh on button path', async () => {
        const CheckoutSuccess = require('../app/checkout/success').default
        let tree!: ReturnType<typeof create>

        await act(async () => {
            tree = create(<CheckoutSuccess />)
        })

        const button = tree.root.findByProps({ testID: 'checkout-success-button' })

        await act(async () => {
            await button.props.onPress()
        })

        expect(mockRefreshBootstrap).toHaveBeenCalledWith('purchase')
        expect(mockReplace).toHaveBeenCalledWith('/')
    })
})