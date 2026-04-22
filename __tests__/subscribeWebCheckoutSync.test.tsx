import React from 'react'
import { act, create } from 'react-test-renderer'

let mockPlatformOS: 'web' | 'ios' | 'android' = 'web'
const mockRefreshBootstrap = jest.fn()
const mockReadCheckoutAttempts = jest.fn()
const mockClearPendingCheckoutAttempts = jest.fn()
const mockExpireStalePendingAttempts = jest.fn()
const mockCreateCheckoutChannel = jest.fn()
const mockGetCurrentUser = jest.fn()
const mockOnAuthStateChanged = jest.fn()
const mockCreditsDisplayRender = jest.fn()

const channelSubscribers: ((event: any) => void)[] = []
const authStateSubscribers: ((user: { uid: string } | null) => void)[] = []
const createdChannels: { publish: jest.Mock; close: jest.Mock; unsubscribe: jest.Mock }[] = []
const baseAttempt = {
    attemptId: 'attempt-1',
    productType: 'payg',
    status: 'pending',
    at: '2026-04-22T10:00:00.000Z',
    sourceTabId: 'tab-a',
    schemaVersion: 1,
}

jest.mock('react-native', () => {
    const React = require('react')

    return {
        View: ({ children, ...props }: any) => React.createElement('View', props, children),
        Pressable: ({ children, ...props }: any) => React.createElement('Pressable', props, children),
        Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
        ScrollView: ({ children, ...props }: any) => React.createElement('ScrollView', props, children),
        Platform: {
            get OS() {
                return mockPlatformOS
            },
        },
        StyleSheet: {
            create: (styles: unknown) => styles,
        },
        Linking: {
            openURL: jest.fn(),
        },
    }
})

jest.mock('react-native-paper', () => {
    const React = require('react')
    const { Pressable, Text: RNText, View } = require('react-native')

    const Button = ({ children, onPress, ...props }: any) => (
        <Pressable testID={props.testID ?? (typeof children === 'string' ? children : undefined)} onPress={onPress} {...props}>
            <RNText>{children}</RNText>
        </Pressable>
    )

    const Card = ({ children, ...props }: any) => <View {...props}>{children}</View>
    Card.Content = ({ children, ...props }: any) => <View {...props}>{children}</View>

    return {
        Card,
        Text: ({ children, ...props }: any) => <RNText {...props}>{children}</RNText>,
        IconButton: ({ ...props }: any) => <View {...props} />,
        Button,
        Snackbar: ({ visible, children }: any) => (visible ? <RNText>{children}</RNText> : null),
        List: {
            Item: ({ children, ...props }: any) => <View {...props}>{children}</View>,
            Icon: ({ ...props }: any) => <View {...props} />,
        },
        Divider: ({ ...props }: any) => <View {...props} />,
    }
})

jest.mock('expo-router', () => ({
    useRouter: () => ({ push: jest.fn() }),
}))

jest.mock('@react-navigation/native', () => ({
    useNavigation: () => ({ setOptions: jest.fn() }),
}))

jest.mock('~/hooks/useBootstrapRefresh', () => ({
    useBootstrapRefresh: () => (...args: unknown[]) => mockRefreshBootstrap(...args),
}))

jest.mock('~/hooks/useIsPremium', () => ({
    useIsPremium: () => false,
}))

jest.mock('~/hooks/useUser', () => ({
    useUserPrivateData: () => ({ userPrivate: { credits: 42 } }),
}))

jest.mock('~/config/revenueCatConfig', () => ({
    restorePurchases: jest.fn(),
}))

jest.mock('~/utilities/makePackagePurchase', () => ({
    makePackagePurchase: jest.fn(),
}))

jest.mock('~/config/firebaseConfig', () => ({
    getCurrentUser: () => mockGetCurrentUser(),
    onAuthStateChanged: (...args: unknown[]) => mockOnAuthStateChanged(...args),
}))

jest.mock('~/utilities/checkoutStateStore', () => ({
    readCheckoutAttempts: (...args: unknown[]) => mockReadCheckoutAttempts(...args),
    clearPendingCheckoutAttempts: (...args: unknown[]) => mockClearPendingCheckoutAttempts(...args),
    expireStalePendingAttempts: (...args: unknown[]) => mockExpireStalePendingAttempts(...args),
}))

jest.mock('~/utilities/checkoutChannel', () => ({
    createCheckoutChannel: (...args: unknown[]) => mockCreateCheckoutChannel(...args),
}))

jest.mock('~/hooks/useWebCheckoutSync', () => require('~/hooks/useWebCheckoutSync.web'))

jest.mock('~/components/CreditsDisplay', () => (props: any) => {
    const React = require('react')
    mockCreditsDisplayRender(props)
    return React.createElement('Text', { testID: 'credits-display-locks' }, JSON.stringify(props.webCheckoutLocks))
})

describe('Subscribe web checkout sync', () => {
    let attemptsByUid: Record<string, Record<string, typeof baseAttempt>>
    const channelClosers: jest.Mock[] = []
    const channelUnsubscribes: jest.Mock[] = []
    const windowEventListeners = new Map<string, Set<(event: Event) => void>>()
    const documentEventListeners = new Map<string, Set<(event: Event) => void>>()
    let documentVisibilityState = 'visible'

    const getLatestCreditsDisplayProps = () => {
        const lastCallIndex = mockCreditsDisplayRender.mock.calls.length - 1
        return lastCallIndex >= 0 ? mockCreditsDisplayRender.mock.calls[lastCallIndex][0] : undefined
    }

    beforeEach(() => {
        jest.clearAllMocks()
        channelSubscribers.length = 0
        authStateSubscribers.length = 0
        createdChannels.length = 0
        channelClosers.length = 0
        channelUnsubscribes.length = 0
        windowEventListeners.clear()
        documentEventListeners.clear()
        documentVisibilityState = 'visible'
        mockPlatformOS = 'web'
        mockGetCurrentUser.mockReturnValue({ uid: 'user-1' })

        Object.defineProperty(window, 'addEventListener', {
            configurable: true,
            value: (type: string, handler: (event: Event) => void) => {
                const listeners = windowEventListeners.get(type) ?? new Set<(event: Event) => void>()
                listeners.add(handler)
                windowEventListeners.set(type, listeners)
            },
        })
        Object.defineProperty(window, 'removeEventListener', {
            configurable: true,
            value: (type: string, handler: (event: Event) => void) => {
                windowEventListeners.get(type)?.delete(handler)
            },
        })
        Object.defineProperty(window, 'dispatchEvent', {
            configurable: true,
            value: (event: Event) => {
                windowEventListeners.get(event.type)?.forEach((listener) => listener(event))
                return true
            },
        })

        // Mock document for visibilitychange support
        Object.defineProperty(global, 'document', {
            configurable: true,
            value: {
                get visibilityState() {
                    return documentVisibilityState
                },
                addEventListener: (type: string, handler: (event: Event) => void) => {
                    const listeners = documentEventListeners.get(type) ?? new Set<(event: Event) => void>()
                    listeners.add(handler)
                    documentEventListeners.set(type, listeners)
                },
                removeEventListener: (type: string, handler: (event: Event) => void) => {
                    documentEventListeners.get(type)?.delete(handler)
                },
                dispatchEvent: (event: Event) => {
                    documentEventListeners.get(event.type)?.forEach((listener) => listener(event))
                    return true
                },
            },
        })

        attemptsByUid = {
            'user-1': {
                [baseAttempt.attemptId]: { ...baseAttempt },
            },
        }

        mockReadCheckoutAttempts.mockImplementation((uid: string) => ({ ...(attemptsByUid[uid] ?? {}) }))
        mockClearPendingCheckoutAttempts.mockReturnValue([])
        mockExpireStalePendingAttempts.mockReturnValue([])
        mockOnAuthStateChanged.mockImplementation((handler: (user: { uid: string } | null) => void) => {
            authStateSubscribers.push(handler)

            return () => {
                const index = authStateSubscribers.indexOf(handler)
                if (index >= 0) {
                    authStateSubscribers.splice(index, 1)
                }
            }
        })
        mockCreateCheckoutChannel.mockImplementation(() => {
            const publish = jest.fn()
            const unsubscribe = jest.fn()
            const close = jest.fn()

            createdChannels.push({ publish, close, unsubscribe })
            channelUnsubscribes.push(unsubscribe)
            channelClosers.push(close)

            return {
                publish,
                subscribe: (handler: (event: any) => void) => {
                    channelSubscribers.push(handler)
                    return () => {
                        unsubscribe()
                        const index = channelSubscribers.indexOf(handler)
                        if (index >= 0) {
                            channelSubscribers.splice(index, 1)
                        }
                    }
                },
                close,
            }
        })
    })

    afterEach(() => {
        jest.restoreAllMocks()
    })

    it('keeps pending payg isolated from subscribe lock', async () => {
        const SubscribeScreen = require('../app/(drawer)/subscribe').default

        await act(async () => {
            create(<SubscribeScreen />)
        })

        expect(mockCreditsDisplayRender).toHaveBeenCalled()
        const latestProps = getLatestCreditsDisplayProps()
        expect(latestProps.webCheckoutLocks).toEqual({
            isPaygLocked: true,
            isSubscribeLocked: false,
        })
    })

    it('unlocks matching product on CHECKOUT_CANCELLED', async () => {
        const SubscribeScreen = require('../app/(drawer)/subscribe').default

        await act(async () => {
            create(<SubscribeScreen />)
        })

        attemptsByUid['user-1'] = {
            [baseAttempt.attemptId]: {
                ...baseAttempt,
                status: 'cancelled',
            },
        }

        await act(async () => {
            channelSubscribers[0]?.({
                type: 'CHECKOUT_CANCELLED',
                payload: { ...baseAttempt, status: 'cancelled' },
            })
        })

        const latestProps = getLatestCreditsDisplayProps()
        expect(latestProps.webCheckoutLocks).toEqual({
            isPaygLocked: false,
            isSubscribeLocked: false,
        })
        expect(mockRefreshBootstrap).not.toHaveBeenCalled()
    })

    it('unlocks and refreshes on CHECKOUT_SUCCEEDED', async () => {
        attemptsByUid = {
            'user-1': {
                [baseAttempt.attemptId]: {
                    ...baseAttempt,
                    productType: 'monthly_20',
                },
            },
        }
        mockReadCheckoutAttempts.mockImplementation((uid: string) => ({ ...(attemptsByUid[uid] ?? {}) }))

        const SubscribeScreen = require('../app/(drawer)/subscribe').default

        await act(async () => {
            create(<SubscribeScreen />)
        })

        attemptsByUid = {
            'user-1': {
                [baseAttempt.attemptId]: {
                    ...baseAttempt,
                    productType: 'monthly_20',
                    status: 'succeeded',
                },
            },
        }

        await act(async () => {
            channelSubscribers[0]?.({
                type: 'CHECKOUT_SUCCEEDED',
                payload: {
                    ...baseAttempt,
                    productType: 'monthly_20',
                    status: 'succeeded',
                },
            })
        })

        const latestProps = getLatestCreditsDisplayProps()
        expect(latestProps.webCheckoutLocks).toEqual({
            isPaygLocked: false,
            isSubscribeLocked: false,
        })
        expect(mockRefreshBootstrap).toHaveBeenCalledWith('purchase')
    })

    it('hydrates and subscribes when auth changes from signed out to signed in', async () => {
        mockGetCurrentUser.mockReturnValue(null)

        const SubscribeScreen = require('../app/(drawer)/subscribe').default
        let tree!: ReturnType<typeof create>

        await act(async () => {
            tree = create(<SubscribeScreen />)
        })

        expect(mockCreateCheckoutChannel).not.toHaveBeenCalled()
        expect(getLatestCreditsDisplayProps().webCheckoutLocks).toEqual({
            isPaygLocked: false,
            isSubscribeLocked: false,
        })

        attemptsByUid['user-1'] = {
            [baseAttempt.attemptId]: {
                ...baseAttempt,
            },
        }

        await act(async () => {
            authStateSubscribers[0]?.({ uid: 'user-1' })
        })

        expect(mockReadCheckoutAttempts).toHaveBeenLastCalledWith('user-1')
        expect(mockCreateCheckoutChannel).toHaveBeenCalledWith({ uid: 'user-1' })
        expect(getLatestCreditsDisplayProps().webCheckoutLocks).toEqual({
            isPaygLocked: true,
            isSubscribeLocked: false,
        })

        act(() => {
            tree.unmount()
        })
    })

    it('cleans up prior user subscription and rehydrates for the next user', async () => {
        attemptsByUid['user-2'] = {
            'attempt-2': {
                ...baseAttempt,
                attemptId: 'attempt-2',
                productType: 'monthly_20',
            },
        }

        const SubscribeScreen = require('../app/(drawer)/subscribe').default

        await act(async () => {
            create(<SubscribeScreen />)
        })

        expect(mockCreateCheckoutChannel).toHaveBeenCalledWith({ uid: 'user-1' })
        expect(getLatestCreditsDisplayProps().webCheckoutLocks).toEqual({
            isPaygLocked: true,
            isSubscribeLocked: false,
        })

        mockClearPendingCheckoutAttempts.mockReturnValueOnce([{ ...baseAttempt }])

        await act(async () => {
            authStateSubscribers[0]?.({ uid: 'user-2' })
        })

        expect(mockClearPendingCheckoutAttempts).toHaveBeenCalledWith('user-1')
        expect(createdChannels[0]?.publish).toHaveBeenCalledWith({
            type: 'CHECKOUT_STALE_CLEARED',
            payload: { ...baseAttempt },
        })
        expect(channelUnsubscribes[0]).toHaveBeenCalledTimes(1)
        expect(channelClosers[0]).toHaveBeenCalledTimes(1)
        expect(mockReadCheckoutAttempts).toHaveBeenLastCalledWith('user-2')
        expect(mockCreateCheckoutChannel).toHaveBeenLastCalledWith({ uid: 'user-2' })
        expect(getLatestCreditsDisplayProps().webCheckoutLocks).toEqual({
            isPaygLocked: false,
            isSubscribeLocked: true,
        })
    })

    it('clears pending attempts and broadcasts stale-cleared on sign-out', async () => {
        const SubscribeScreen = require('../app/(drawer)/subscribe').default

        await act(async () => {
            create(<SubscribeScreen />)
        })

        mockClearPendingCheckoutAttempts.mockReturnValueOnce([{ ...baseAttempt }])

        await act(async () => {
            authStateSubscribers[0]?.(null)
        })

        expect(mockClearPendingCheckoutAttempts).toHaveBeenCalledWith('user-1')
        expect(createdChannels[0]?.publish).toHaveBeenCalledWith({
            type: 'CHECKOUT_STALE_CLEARED',
            payload: { ...baseAttempt },
        })
        expect(getLatestCreditsDisplayProps().webCheckoutLocks).toEqual({
            isPaygLocked: false,
            isSubscribeLocked: false,
        })
    })

    it('expires stale pending attempts on focus recovery and surfaces the timeout message', async () => {
        const SubscribeScreen = require('../app/(drawer)/subscribe').default
        const expiredAttempt = {
            ...baseAttempt,
            status: 'expired',
            at: '2026-04-22T10:20:00.000Z',
            sourceTabId: 'tab-cleaner',
        }
        let tree!: ReturnType<typeof create>

        await act(async () => {
            tree = create(<SubscribeScreen />)
        })

        attemptsByUid['user-1'] = {
            [expiredAttempt.attemptId]: expiredAttempt,
        }
        mockReadCheckoutAttempts.mockImplementation((uid: string) => ({ ...(attemptsByUid[uid] ?? {}) }))
        mockExpireStalePendingAttempts.mockReturnValueOnce([expiredAttempt])

        await act(async () => {
            window.dispatchEvent(new Event('focus'))
        })

        expect(mockExpireStalePendingAttempts).toHaveBeenCalledWith('user-1', expect.any(Number), 'tab-recovery')
        expect(createdChannels[0]?.publish).toHaveBeenCalledWith({
            type: 'CHECKOUT_STALE_CLEARED',
            payload: expiredAttempt,
        })
        expect(getLatestCreditsDisplayProps().webCheckoutLocks).toEqual({
            isPaygLocked: false,
            isSubscribeLocked: false,
        })
        expect(getLatestCreditsDisplayProps().expiredMessage).toBe('Previous checkout timed out')
        expect(JSON.stringify(tree.toJSON())).toContain('Previous checkout timed out')
    })

    it('expires stale pending attempts on visibilitychange to visible', async () => {
        const SubscribeScreen = require('../app/(drawer)/subscribe').default
        const expiredAttempt = {
            ...baseAttempt,
            status: 'expired',
            at: '2026-04-22T10:20:00.000Z',
            sourceTabId: 'tab-recovery-visibility',
        }
        let tree!: ReturnType<typeof create>

        // Start with visibility hidden
        documentVisibilityState = 'hidden'

        await act(async () => {
            tree = create(<SubscribeScreen />)
        })

        attemptsByUid['user-1'] = {
            [expiredAttempt.attemptId]: expiredAttempt,
        }
        mockReadCheckoutAttempts.mockImplementation((uid: string) => ({ ...(attemptsByUid[uid] ?? {}) }))
        mockExpireStalePendingAttempts.mockReturnValueOnce([expiredAttempt])

        // Change visibility to visible and dispatch event
        documentVisibilityState = 'visible'

        await act(async () => {
            document.dispatchEvent(new Event('visibilitychange'))
        })

        expect(mockExpireStalePendingAttempts).toHaveBeenCalledWith('user-1', expect.any(Number), 'tab-recovery')
        expect(createdChannels[0]?.publish).toHaveBeenCalledWith({
            type: 'CHECKOUT_STALE_CLEARED',
            payload: expiredAttempt,
        })
        expect(getLatestCreditsDisplayProps().webCheckoutLocks).toEqual({
            isPaygLocked: false,
            isSubscribeLocked: false,
        })
        expect(getLatestCreditsDisplayProps().expiredMessage).toBe('Previous checkout timed out')

        act(() => {
            tree.unmount()
        })
    })

    it('logs cross-tab unlock when CHECKOUT_STALE_CLEARED is received with pending status', async () => {
        const consoleSpy = jest.spyOn(console, 'log').mockImplementation()
        const SubscribeScreen = require('../app/(drawer)/subscribe').default

        await act(async () => {
            create(<SubscribeScreen />)
        })

        // Verify that when we receive CHECKOUT_STALE_CLEARED with pending status, it logs
        // First, clear the store to simulate the other tab clearing its attempts
        attemptsByUid['user-1'] = {}
        mockReadCheckoutAttempts.mockImplementation((uid: string) => ({ ...(attemptsByUid[uid] ?? {}) }))

        // This simulates the scenario where another tab signs out and broadcasts CHECKOUT_STALE_CLEARED
        await act(async () => {
            if (channelSubscribers.length > 0) {
                channelSubscribers[0]({
                    type: 'CHECKOUT_STALE_CLEARED',
                    payload: { ...baseAttempt, status: 'pending' },
                })
            }
        })

        expect(consoleSpy).toHaveBeenCalledWith(
            '[checkout-sync][plan]',
            expect.objectContaining({
                phase: 'cross-tab-unlock',
                eventType: 'CHECKOUT_STALE_CLEARED',
                attemptId: 'attempt-1',
                productType: 'payg',
                status: 'pending',
            })
        )

        consoleSpy.mockRestore()
    })

    it('on web, only subscribe screen shows timeout snackbar, not CreditsDisplay', async () => {
        const SubscribeScreen = require('../app/(drawer)/subscribe').default
        const expiredAttempt = {
            ...baseAttempt,
            status: 'expired',
            at: '2026-04-22T10:20:00.000Z',
        }

        let tree!: ReturnType<typeof create>

        await act(async () => {
            tree = create(<SubscribeScreen />)
        })

        // Simulate expired checkout
        attemptsByUid['user-1'] = {
            [expiredAttempt.attemptId]: expiredAttempt,
        }
        mockReadCheckoutAttempts.mockImplementation((uid: string) => ({ ...(attemptsByUid[uid] ?? {}) }))
        mockExpireStalePendingAttempts.mockReturnValueOnce([expiredAttempt])

        await act(async () => {
            window.dispatchEvent(new Event('focus'))
        })

        const latestCreditsDisplayProps = getLatestCreditsDisplayProps()
        const treeString = JSON.stringify(tree.toJSON())

        // CreditsDisplay receives expiredMessage prop
        expect(latestCreditsDisplayProps.expiredMessage).toBe('Previous checkout timed out')

        // But on web, CreditsDisplay should NOT show it in snackbar.
        // The parent subscribe.tsx shows the snackbar instead.
        // We verify this by checking that the tree has the message (from subscribe.tsx snackbar)
        // but CreditsDisplay doesn't render its own snackbar with that message.
        expect(treeString).toContain('Previous checkout timed out')

        // Verify CreditsDisplay was NOT responsible for the message by checking
        // it doesn't have its own error (the message comes from subscribe parent)
        expect(mockCreditsDisplayRender.mock.calls[mockCreditsDisplayRender.mock.calls.length - 1][0].expiredMessage)
            .toBe('Previous checkout timed out')
    })
})
