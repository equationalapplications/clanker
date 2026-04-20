import React from 'react'
import { act, create } from 'react-test-renderer'

const mockReplace = jest.fn()
const mockGetUserState = jest.fn()
const mockAuthSend = jest.fn()

jest.mock('expo-router', () => ({
    useRouter: () => ({ replace: mockReplace }),
}))

jest.mock('~/services/apiClient', () => ({
    getUserState: (...args: unknown[]) => mockGetUserState(...args),
}))

jest.mock('~/hooks/useMachines', () => ({
    useAuthMachine: () => ({ send: (...args: unknown[]) => mockAuthSend(...args) }),
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
        mockGetUserState.mockResolvedValue({})
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

        expect(mockGetUserState).not.toHaveBeenCalled()
        expect(mockAuthSend).toHaveBeenCalledWith({ type: 'REFRESH_BOOTSTRAP' })
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

        expect(mockGetUserState).not.toHaveBeenCalled()
        expect(mockAuthSend).toHaveBeenCalledWith({ type: 'REFRESH_BOOTSTRAP' })
        expect(mockReplace).toHaveBeenCalledWith('/')
    })
})