import React from 'react'
import { create, act } from 'react-test-renderer'

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }))
jest.mock('~/hooks/useMachines', () => ({ useAuthMachine: jest.fn() }))
jest.mock('@xstate/react', () => ({ useSelector: (_: any, sel: any) => sel({ context: { user: null }, matches: () => false }) }))
jest.mock('react-native-reanimated', () => {
  const React = require('react')
  return {
    default: ({ children }: any) => children,
    View: ({ children, style, entering }: any) => React.createElement('View', { style }, children),
    useSharedValue: (v: any) => ({ value: v }),
    useAnimatedStyle: (fn: any) => ({}),
    withRepeat: (v: any) => v,
    withTiming: (v: any) => v,
    withSequence: (...args: any[]) => args[0],
    FadeInDown: { delay: () => ({ duration: () => ({}) }) },
  }
})
jest.mock('react-native', () => {
  const React = require('react')
  return {
    StyleSheet: { create: (s: any) => s, flatten: (s: any) => s },
    View: ({ children, style }: any) => React.createElement('View', { style }, children),
    useWindowDimensions: () => ({ width: 390, height: 844 }),
  }
})
jest.mock('expo-image', () => {
  const React = require('react')
  return {
    Image: ({ accessibilityLabel, accessibilityRole, ...props }: any) =>
      React.createElement('ExpoImage', { accessibilityLabel, accessibilityRole, ...props }),
  }
})
jest.mock('react-native-paper', () => {
  const React = require('react')
  return {
    useTheme: () => ({ colors: { primary: '#000', onPrimary: '#fff', onBackground: '#000', background: '#fff' } }),
    Button: ({ children, onPress, ...props }: any) => React.createElement('Button', { onPress, ...props }, children),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
  }
})
jest.mock('~/components/StyledText', () => {
  const React = require('react')
  return {
    TitleText: ({ children, ...props }: any) => React.createElement('Text', props, children),
    MonoText: ({ children, ...props }: any) => React.createElement('Text', props, children),
  }
})

import HeroSection from '~/components/LandingPage/HeroSection'

describe('HeroSection accessibility', () => {
  it('logo image has accessibilityLabel "Clanker application logo"', () => {
    let tree: any
    act(() => { tree = create(<HeroSection />) })
    const images = tree.root.findAllByType('ExpoImage')
    expect(images.length).toBeGreaterThan(0)
    const logoImage = images[0]
    expect(logoImage.props.accessibilityLabel).toBe('Clanker application logo')
  })

  it('logo image has accessibilityRole "image"', () => {
    let tree: any
    act(() => { tree = create(<HeroSection />) })
    const images = tree.root.findAllByType('ExpoImage')
    const logoImage = images[0]
    expect(logoImage.props.accessibilityRole).toBe('image')
  })
})
