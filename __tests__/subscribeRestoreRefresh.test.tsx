import React from 'react'
import { act, create } from 'react-test-renderer'

let mockPlatformOS: 'web' | 'ios' | 'android' = 'ios'
const mockRestorePurchases = jest.fn()
const mockRefreshBootstrap = jest.fn()

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

    const Button = ({ children, onPress, ...props }: any) => {
        const testIdFromChildren = typeof children === 'string' ? children : undefined
        return (
            <Pressable testID={props.testID ?? testIdFromChildren} onPress={onPress} {...props}>
                <RNText>{children}</RNText>
            </Pressable>
        )
    }

    const Card = ({ children, ...props }: any) => <View {...props}>{children}</View>
    Card.Content = ({ children, ...props }: any) => <View {...props}>{children}</View>

    const Text = ({ children, ...props }: any) => <RNText {...props}>{children}</RNText>
    const Snackbar = ({ visible, children }: any) => (visible ? <RNText>{children}</RNText> : null)
    const IconButton = ({ ...props }: any) => <View {...props} />
    const List = {
        Item: ({ children, ...props }: any) => <View {...props}>{children}</View>,
        Icon: ({ ...props }: any) => <View {...props} />,
    }
    const Divider = ({ ...props }: any) => <View {...props} />

    return { Card, Text, IconButton, Button, Snackbar, List, Divider }
})

jest.mock('expo-router', () => ({
    useRouter: () => ({ push: jest.fn() }),
}))

jest.mock('@react-navigation/native', () => ({
    useNavigation: () => ({ setOptions: jest.fn() }),
}))

jest.mock('@xstate/react', () => ({
    useSelector: jest.fn(() => ({ uid: 'firebase-uid-restore' })),
}))

jest.mock('~/hooks/useMachines', () => ({
    useAuthMachine: () => ({ send: jest.fn() }),
}))

jest.mock('~/hooks/useBootstrapRefresh', () => ({
    useBootstrapRefresh: () => (...args: unknown[]) => mockRefreshBootstrap(...args),
}))

jest.mock('~/hooks/useIsPremium', () => ({
    useIsPremium: () => false,
}))

jest.mock('~/hooks/useUser', () => ({
    useUserPrivateData: () => ({ userPrivate: { credits: 42 } }),
    userKeys: {
        private: (uid: string | undefined) => ['user', 'private', uid],
    },
}))

jest.mock('~/utilities/makePackagePurchase', () => ({
    makePackagePurchase: jest.fn(),
}))

jest.mock('~/config/revenueCatConfig', () => ({
    restorePurchases: (...args: unknown[]) => mockRestorePurchases(...args),
}))

jest.mock('~/components/CreditsDisplay', () => () => null)

describe('Subscribe restore refresh behavior', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockPlatformOS = 'ios'
        mockRestorePurchases.mockResolvedValue(undefined)
    })

    it('uses single bootstrap refresh path on restore', async () => {
        const SubscribeScreen = require('../app/(drawer)/subscribe').default
        let tree!: ReturnType<typeof create>

        await act(async () => {
            tree = create(<SubscribeScreen />)
        })

        const restoreButton = tree.root.findByProps({ testID: 'Restore Purchases' })

        await act(async () => {
            await restoreButton.props.onPress()
        })

        expect(mockRestorePurchases).toHaveBeenCalled()
        expect(mockRefreshBootstrap).toHaveBeenCalledWith('restore')
    })
})