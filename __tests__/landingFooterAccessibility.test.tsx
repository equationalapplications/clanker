import React from 'react'
import { create, act } from 'react-test-renderer'

jest.mock('~/components/CookieConsent', () => ({
  useCookieConsent: () => ({ openPreferences: jest.fn() }),
}))

jest.mock('expo-router', () => {
  const React = require('react')
  return {
    Link: ({ children, href, asChild }: any) => React.createElement('Link', { href }, children),
  }
})

jest.mock('react-native', () => {
  const React = require('react')
  return {
    StyleSheet: { create: (s: any) => s, flatten: (s: any) => s },
    View: ({ children, style }: any) => React.createElement('View', { style }, children),
    Pressable: ({ children, onPress, accessibilityRole, accessibilityLabel, style }: any) =>
      React.createElement('Pressable', { onPress, accessibilityRole, accessibilityLabel, style }, children),
    Linking: { openURL: jest.fn().mockResolvedValue(undefined) },
    Platform: { OS: 'ios' },
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
  }
})

jest.mock('react-native-paper', () => {
  const React = require('react')
  return {
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    useTheme: () => ({ colors: { outline: '#666' } }),
  }
})

import LandingFooter from '~/components/LandingPage/LandingFooter'

describe('LandingFooter accessibility', () => {
  it('external Equational Applications link has accessibilityLabel mentioning destination', () => {
    let tree: any
    act(() => { tree = create(<LandingFooter />) })

    const pressables = tree.root.findAllByType('Pressable')
    const externalLink = pressables.find((p: any) => p.props.accessibilityRole === 'link' && p.props.accessibilityLabel)
    expect(externalLink).toBeDefined()
    expect(externalLink!.props.accessibilityLabel).toContain('Equational Applications')
  })
})
