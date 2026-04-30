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
    Platform: { OS: 'web' },
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
  it('renders a skip link <a> element with href="#main-content"', () => {
    let tree: any
    act(() => { tree = create(<LandingPage />) })

    const skipLinks = tree.root.findAll(
      (node: any) => node.type === 'a' && node.props.href === '#main-content',
    )
    expect(skipLinks.length).toBe(1)
    expect(skipLinks[0].props.href).toBe('#main-content')
  })

  it('skip link text is "Skip to main content"', () => {
    let tree: any
    act(() => { tree = create(<LandingPage />) })

    const skipLinks = tree.root.findAll(
      (node: any) => node.type === 'a' && node.props.href === '#main-content',
    )
    expect(skipLinks[0].props.children).toBe('Skip to main content')
  })

  it('main content area has nativeID="main-content"', () => {
    let tree: any
    act(() => { tree = create(<LandingPage />) })

    const mainContent = tree.root.findAll((node: any) => node.props.nativeID === 'main-content')
    expect(mainContent.length).toBeGreaterThan(0)
  })
})
