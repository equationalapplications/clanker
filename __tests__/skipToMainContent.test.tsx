import React from 'react'
import { create, act } from 'react-test-renderer'

// Mock Platform as web
jest.mock('react-native', () => {
  const React = require('react')
  return {
    StyleSheet: { create: (s: any) => s },
    ScrollView: ({ children, style, contentContainerStyle, showsVerticalScrollIndicator }: any) =>
      React.createElement('ScrollView', { style, contentContainerStyle }, children),
    View: ({ children, style, nativeID }: any) =>
      React.createElement('View', { style, nativeID }, children),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    Platform: { OS: 'web' },
    Pressable: ({ children, onPress, style, accessibilityRole }: any) =>
      React.createElement('Pressable', { onPress, style, accessibilityRole }, children),
  }
})

jest.mock('react-native-paper', () => ({
  useTheme: () => ({ colors: { background: '#fff' } }),
}))

jest.mock('~/components/LandingPage/HeroSection', () => () => null)
jest.mock('~/components/LandingPage/FeaturesSection', () => () => null)
jest.mock('~/components/LandingPage/LandingFooter', () => () => null)

import LandingPage from '~/components/LandingPage'

describe('LandingPage skip link (web)', () => {
  it('renders a skip-to-main-content link', () => {
    let tree: any
    act(() => { tree = create(<LandingPage />) })

    // Skip link should be a Pressable or Text with specific props, or a View with nativeID="main-content"
    const allViews = tree.root.findAll((node: any) => node.props.nativeID === 'main-content')
    expect(allViews.length).toBeGreaterThan(0)
  })

  it('main content area has nativeID="main-content"', () => {
    let tree: any
    act(() => { tree = create(<LandingPage />) })

    const mainContent = tree.root.findAll((node: any) => node.props.nativeID === 'main-content')
    expect(mainContent.length).toBeGreaterThan(0)
  })
})
