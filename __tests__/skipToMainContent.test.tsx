import React from 'react'
import { create, act } from 'react-test-renderer'

// Mock Platform as web
jest.mock('react-native', () => {
  const React = require('react')
  return {
    StyleSheet: { create: (s: any) => s },
    ScrollView: ({ children, style, contentContainerStyle, showsVerticalScrollIndicator }: any) =>
      React.createElement('ScrollView', { style, contentContainerStyle }, children),
    View: ({ children, style, nativeID, accessibilityRole, accessibilityLabel }: any) =>
      React.createElement('View', { style, nativeID, accessibilityRole, accessibilityLabel }, children),
    Text: ({ children, style }: any) =>
      React.createElement('Text', { style }, children),
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
  it('renders a skip link View with accessibilityRole="link" and label "Skip to main content"', () => {
    let tree: any
    act(() => { tree = create(<LandingPage />) })

    const skipLinks = tree.root.findAll(
      (node: any) => node.type === 'View' && node.props.accessibilityRole === 'link',
    )
    expect(skipLinks.length).toBe(1)
    expect(skipLinks[0].props.accessibilityLabel).toBe('Skip to main content')
  })

  it('skip link View contains Text "Skip to main content"', () => {
    let tree: any
    act(() => { tree = create(<LandingPage />) })

    const skipLinks = tree.root.findAll(
      (node: any) => node.type === 'View' && node.props.accessibilityRole === 'link',
    )
    expect(skipLinks.length).toBe(1)
    const texts = skipLinks[0].findAll((n: any) => n.type === 'Text')
    expect(texts.length).toBeGreaterThan(0)
    expect(texts[0].props.children).toBe('Skip to main content')
  })

  it('main content area has nativeID="main-content"', () => {
    let tree: any
    act(() => { tree = create(<LandingPage />) })

    const mainContent = tree.root.findAll((node: any) => node.props.nativeID === 'main-content')
    expect(mainContent.length).toBeGreaterThan(0)
  })
})
