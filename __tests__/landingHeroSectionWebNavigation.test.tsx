import React from 'react'
import { act, create } from 'react-test-renderer'

jest.mock('react-native', () => {
  const React = require('react')

  return {
    StyleSheet: {
      create: (styles: any) => styles,
    },
    View: ({ children, style, ...props }: any) =>
      React.createElement('View', { style, ...props }, children),
    Pressable: ({ children, onPress, ...props }: any) =>
      React.createElement('Pressable', { onPress, ...props }, children),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    useWindowDimensions: () => ({ height: 800 }),
    Linking: {
      openURL: jest.fn(),
    },
    Platform: {
      OS: 'web',
    },
  }
})

jest.mock('react-native-paper', () => {
  const React = require('react')

  return {
    useTheme: () => ({
      colors: {
        background: '#ffffff',
        surface: '#f5f5f5',
        primary: '#6200ee',
        onPrimary: '#ffffff',
        onBackground: '#000000',
        onSurface: '#000000',
        outline: '#999999',
      },
    }),
    Button: ({ children, onPress, ...props }: any) =>
      React.createElement('Button', { onPress, ...props }, children),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
  }
})

jest.mock('expo-image', () => ({
  Image: 'Image',
}))

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}))

jest.mock('react-native-reanimated', () => {
  const React = require('react')

  return {
    useSharedValue: (initialValue: any) => ({
      value: initialValue,
    }),
    useAnimatedStyle: () => ({}),
    withRepeat: (animation: any) => animation,
    withSequence: (...animations: any[]) => animations[0],
    withTiming: (targetValue: any) => targetValue,
    default: ({ children }: any) => children,
    View: ({ children, style, ...props }: any) =>
      React.createElement('View', { style, ...props }, children),
    FadeInDown: {
      delay: (delay: number) => ({
        duration: (duration: number) => ({
          __animationConfig: { delay, duration },
        }),
      }),
    },
  }
})

jest.mock('~/components/StyledText', () => {
  const React = require('react')
  return {
    TitleText: ({ children, ...props }: any) => React.createElement('Text', props, children),
    MonoText: ({ children, ...props }: any) => React.createElement('Text', props, children),
  }
})

jest.mock('@xstate/react', () => ({
  useSelector: jest.fn(),
}))

jest.mock('~/hooks/useMachines', () => ({
  useAuthMachine: jest.fn(),
}))

const mockPush = jest.fn()

// Import AFTER mocking
import { useSelector } from '@xstate/react'
import { useAuthMachine } from '~/hooks/useMachines'
import HeroSection from '~/components/LandingPage/HeroSection'

describe('HeroSection Web Navigation', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('routes to sign-in redirect when top-right Sign In button is clicked (not signed in)', () => {
    // Setup: mock auth state as not signed in
    const mockAuthService = {}
    ;(useAuthMachine as jest.Mock).mockReturnValue(mockAuthService)
    ;(useSelector as jest.Mock).mockReturnValue(false)

    let tree: any
    act(() => {
      tree = create(<HeroSection />)
    })

    // Find all buttons
    const allButtons = tree.root.findAllByType('Button')
    expect(allButtons.length).toBeGreaterThan(0)

    // The first button should be the top-right sign in button
    const topBarSignInButton = allButtons[0]

    act(() => {
      topBarSignInButton.props.onPress()
    })

    expect(mockPush).toHaveBeenCalledWith('/sign-in?redirect=/chat')
    expect(mockPush).toHaveBeenCalledTimes(1)
  })

  it('routes to sign-in redirect when hero CTA button is clicked (not signed in)', () => {
    // Setup: mock auth state as not signed in
    const mockAuthService = {}
    ;(useAuthMachine as jest.Mock).mockReturnValue(mockAuthService)
    ;(useSelector as jest.Mock).mockReturnValue(false)

    let tree: any
    act(() => {
      tree = create(<HeroSection />)
    })

    // Find all buttons
    const allButtons = tree.root.findAllByType('Button')
    expect(allButtons.length).toBeGreaterThan(1)

    // The last button should be the CTA button
    const ctaButton = allButtons[allButtons.length - 1]

    act(() => {
      ctaButton.props.onPress()
    })

    expect(mockPush).toHaveBeenCalledWith('/sign-in?redirect=/chat')
  })

  it('shows "Open App" label when signed in and routes to chat on click', () => {
    // Setup: mock auth state as signed in
    const mockAuthService = {}
    ;(useAuthMachine as jest.Mock).mockReturnValue(mockAuthService)
    ;(useSelector as jest.Mock).mockReturnValue(true)

    let tree: any
    act(() => {
      tree = create(<HeroSection />)
    })

    // Find the top-right button and verify it has "Open App" label
    const allButtons = tree.root.findAllByType('Button')
    const topBarButton = allButtons[0]

    // The button's children should contain "Open App" text
    expect(topBarButton.props.children).toContain('Open App')

    // Click the button and verify it routes internally to /chat
    act(() => {
      topBarButton.props.onPress()
    })

    expect(mockPush).toHaveBeenCalledWith('/chat')
  })
})


