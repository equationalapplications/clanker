import React from 'react'
import { act, create } from 'react-test-renderer'

const mockReplace = jest.fn()
const mockBack = jest.fn()
const mockRefreshBootstrap = jest.fn()
const mockPublish = jest.fn()
const mockClose = jest.fn()
const mockReadCheckoutAttempts = jest.fn()
const mockUpsertCheckoutAttempt = jest.fn()
const mockCreateCheckoutChannel = jest.fn(() => ({
    publish: mockPublish,
    subscribe: jest.fn(),
    close: mockClose,
}))
const mockGetCurrentUser = jest.fn()
const mockUseLocalSearchParams = jest.fn()

const baseAttempt = {
    attemptId: 'attempt-1',
    productType: 'payg',
    status: 'pending',
    at: '2026-04-22T10:00:00.000Z',
    sourceTabId: 'tab-a',
    schemaVersion: 1,
}

jest.mock('expo-router', () => ({
    useRouter: () => ({ replace: mockReplace, back: mockBack }),
    useLocalSearchParams: () => mockUseLocalSearchParams(),
}))

jest.mock('~/hooks/useBootstrapRefresh', () => ({
    useBootstrapRefresh: () => mockRefreshBootstrap,
}))

jest.mock('~/config/firebaseConfig', () => ({
    getCurrentUser: () => mockGetCurrentUser(),
}))

jest.mock('~/utilities/checkoutChannel', () => ({
    createCheckoutChannel: mockCreateCheckoutChannel,
}))

jest.mock('~/utilities/checkoutStateStore', () => ({
    CHECKOUT_SCHEMA_VERSION: 1,
    readCheckoutAttempts: mockReadCheckoutAttempts,
    upsertCheckoutAttempt: mockUpsertCheckoutAttempt,
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
        mockUseLocalSearchParams.mockReturnValue({ attemptId: undefined })
        mockGetCurrentUser.mockReturnValue({ uid: 'user-1' })
        mockReadCheckoutAttempts.mockReturnValue({})
        mockUpsertCheckoutAttempt.mockImplementation((_uid: string, incoming: unknown) => ({
            applied: true,
            record: incoming,
        }))
    })

    afterEach(() => {
        jest.useRealTimers()
    })

    it('always refreshes purchase bootstrap on success even without matching attempt', async () => {
        const CheckoutSuccess = require('../app/checkout/success').default

        await act(async () => {
            create(<CheckoutSuccess />)
        })

        await act(async () => {
            jest.advanceTimersByTime(3000)
        })

        expect(mockRefreshBootstrap).toHaveBeenCalledWith('purchase')
        expect(mockPublish).not.toHaveBeenCalled()
        expect(mockReplace).toHaveBeenCalledWith('/')
    })

    it('publishes CHECKOUT_SUCCEEDED exactly once when matching attempt exists', async () => {
        mockUseLocalSearchParams.mockReturnValue({ attemptId: 'attempt-1' })
        mockReadCheckoutAttempts.mockReturnValue({ 'attempt-1': baseAttempt })

        const CheckoutSuccess = require('../app/checkout/success').default

        await act(async () => {
            create(<CheckoutSuccess />)
        })

        await act(async () => {
            jest.advanceTimersByTime(3000)
        })

        expect(mockUpsertCheckoutAttempt).toHaveBeenCalledTimes(1)
        expect(mockCreateCheckoutChannel).toHaveBeenCalledTimes(1)
        expect(mockPublish).toHaveBeenCalledTimes(1)
        expect(mockPublish).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'CHECKOUT_SUCCEEDED',
                payload: expect.objectContaining({
                    attemptId: 'attempt-1',
                    status: 'succeeded',
                }),
            }),
        )
        expect(mockRefreshBootstrap).toHaveBeenCalledWith('purchase')
        expect(mockReplace).toHaveBeenCalledWith('/')
    })

    it('does not publish CHECKOUT_SUCCEEDED when upsert does not apply', async () => {
        mockUseLocalSearchParams.mockReturnValue({ attemptId: 'attempt-1' })
        mockReadCheckoutAttempts.mockReturnValue({ 'attempt-1': baseAttempt })
        mockUpsertCheckoutAttempt.mockImplementation((_uid: string, incoming: unknown) => ({
            applied: false,
            record: incoming,
        }))

        const CheckoutSuccess = require('../app/checkout/success').default

        await act(async () => {
            create(<CheckoutSuccess />)
        })

        await act(async () => {
            jest.advanceTimersByTime(3000)
        })

        expect(mockUpsertCheckoutAttempt).toHaveBeenCalledTimes(1)
        expect(mockPublish).not.toHaveBeenCalled()
        expect(mockRefreshBootstrap).toHaveBeenCalledWith('purchase')
        expect(mockReplace).toHaveBeenCalledWith('/')
    })

    it('dedupes success side-effects when button press happens before timer', async () => {
        mockUseLocalSearchParams.mockReturnValue({ attemptId: 'attempt-1' })
        mockReadCheckoutAttempts.mockReturnValue({ 'attempt-1': baseAttempt })

        const CheckoutSuccess = require('../app/checkout/success').default
        let tree!: ReturnType<typeof create>

        await act(async () => {
            tree = create(<CheckoutSuccess />)
        })

        await act(async () => {
            tree.root.findByProps({ testID: 'checkout-success-go-to-app' }).props.onPress()
        })

        await act(async () => {
            jest.advanceTimersByTime(3000)
        })

        expect(mockUpsertCheckoutAttempt).toHaveBeenCalledTimes(1)
        expect(mockPublish).toHaveBeenCalledTimes(1)
        expect(mockRefreshBootstrap).toHaveBeenCalledTimes(1)
        expect(mockReplace).toHaveBeenCalledTimes(2)
    })

    it('dedupes success side-effects when timer fires before button press', async () => {
        mockUseLocalSearchParams.mockReturnValue({ attemptId: 'attempt-1' })
        mockReadCheckoutAttempts.mockReturnValue({ 'attempt-1': baseAttempt })

        const CheckoutSuccess = require('../app/checkout/success').default
        let tree!: ReturnType<typeof create>

        await act(async () => {
            tree = create(<CheckoutSuccess />)
        })

        await act(async () => {
            jest.advanceTimersByTime(3000)
        })

        await act(async () => {
            tree.root.findByProps({ testID: 'checkout-success-go-to-app' }).props.onPress()
        })

        expect(mockUpsertCheckoutAttempt).toHaveBeenCalledTimes(1)
        expect(mockPublish).toHaveBeenCalledTimes(1)
        expect(mockRefreshBootstrap).toHaveBeenCalledTimes(1)
        expect(mockReplace).toHaveBeenCalledTimes(2)
    })

    it('does not publish cancel event when attempt is missing', async () => {
        mockUseLocalSearchParams.mockReturnValue({ attemptId: 'missing-attempt' })
        mockReadCheckoutAttempts.mockReturnValue({})

        const CheckoutCancel = require('../app/checkout/cancel').default

        await act(async () => {
            create(<CheckoutCancel />)
        })

        await act(async () => {
            jest.advanceTimersByTime(3000)
        })

        expect(mockPublish).not.toHaveBeenCalled()
        expect(mockRefreshBootstrap).not.toHaveBeenCalled()
        expect(mockReplace).toHaveBeenCalledWith('/')
    })

    it('publishes CHECKOUT_CANCELLED exactly once when matching attempt exists', async () => {
        mockUseLocalSearchParams.mockReturnValue({ attemptId: 'attempt-1' })
        mockReadCheckoutAttempts.mockReturnValue({ 'attempt-1': baseAttempt })

        const CheckoutCancel = require('../app/checkout/cancel').default

        await act(async () => {
            create(<CheckoutCancel />)
        })

        await act(async () => {
            jest.advanceTimersByTime(3000)
        })

        expect(mockUpsertCheckoutAttempt).toHaveBeenCalledTimes(1)
        expect(mockCreateCheckoutChannel).toHaveBeenCalledTimes(1)
        expect(mockPublish).toHaveBeenCalledTimes(1)
        expect(mockPublish).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'CHECKOUT_CANCELLED',
                payload: expect.objectContaining({
                    attemptId: 'attempt-1',
                    status: 'cancelled',
                }),
            }),
        )
        expect(mockRefreshBootstrap).not.toHaveBeenCalled()
        expect(mockReplace).toHaveBeenCalledWith('/')
    })

    it('does not publish CHECKOUT_CANCELLED when upsert does not apply', async () => {
        mockUseLocalSearchParams.mockReturnValue({ attemptId: 'attempt-1' })
        mockReadCheckoutAttempts.mockReturnValue({ 'attempt-1': baseAttempt })
        mockUpsertCheckoutAttempt.mockImplementation((_uid: string, incoming: unknown) => ({
            applied: false,
            record: incoming,
        }))

        const CheckoutCancel = require('../app/checkout/cancel').default

        await act(async () => {
            create(<CheckoutCancel />)
        })

        await act(async () => {
            jest.advanceTimersByTime(3000)
        })

        expect(mockUpsertCheckoutAttempt).toHaveBeenCalledTimes(1)
        expect(mockPublish).not.toHaveBeenCalled()
        expect(mockReplace).toHaveBeenCalledWith('/')
    })

    it('routes Try again to retry flow and Back to app to root', async () => {
        mockUseLocalSearchParams.mockReturnValue({ attemptId: 'attempt-1' })
        mockReadCheckoutAttempts.mockReturnValue({ 'attempt-1': baseAttempt })

        const CheckoutCancel = require('../app/checkout/cancel').default
        let tree!: ReturnType<typeof create>

        await act(async () => {
            tree = create(<CheckoutCancel />)
        })

        await act(async () => {
            tree.root.findByProps({ testID: 'checkout-cancel-try-again' }).props.onPress()
        })

        expect(mockBack).toHaveBeenCalledTimes(1)
        expect(mockReplace).not.toHaveBeenCalled()

        mockBack.mockClear()
        mockReplace.mockClear()

        await act(async () => {
            tree.root.findByProps({ testID: 'checkout-cancel-back-to-app' }).props.onPress()
        })

        expect(mockBack).not.toHaveBeenCalled()
        expect(mockReplace).toHaveBeenCalledWith('/')
    })

    it('dedupes cancel side-effects when back-to-app press happens before timer', async () => {
        mockUseLocalSearchParams.mockReturnValue({ attemptId: 'attempt-1' })
        mockReadCheckoutAttempts.mockReturnValue({ 'attempt-1': baseAttempt })

        const CheckoutCancel = require('../app/checkout/cancel').default
        let tree!: ReturnType<typeof create>

        await act(async () => {
            tree = create(<CheckoutCancel />)
        })

        await act(async () => {
            tree.root.findByProps({ testID: 'checkout-cancel-back-to-app' }).props.onPress()
        })

        await act(async () => {
            jest.advanceTimersByTime(3000)
        })

        expect(mockUpsertCheckoutAttempt).toHaveBeenCalledTimes(1)
        expect(mockPublish).toHaveBeenCalledTimes(1)
        expect(mockReplace).toHaveBeenCalledTimes(2)
    })

    it('dedupes cancel side-effects when timer fires before back-to-app press', async () => {
        mockUseLocalSearchParams.mockReturnValue({ attemptId: 'attempt-1' })
        mockReadCheckoutAttempts.mockReturnValue({ 'attempt-1': baseAttempt })

        const CheckoutCancel = require('../app/checkout/cancel').default
        let tree!: ReturnType<typeof create>

        await act(async () => {
            tree = create(<CheckoutCancel />)
        })

        await act(async () => {
            jest.advanceTimersByTime(3000)
        })

        await act(async () => {
            tree.root.findByProps({ testID: 'checkout-cancel-back-to-app' }).props.onPress()
        })

        expect(mockUpsertCheckoutAttempt).toHaveBeenCalledTimes(1)
        expect(mockPublish).toHaveBeenCalledTimes(1)
        expect(mockReplace).toHaveBeenCalledTimes(2)
    })
})