import React from 'react'
import { create, act } from 'react-test-renderer'

jest.mock('react-native-reanimated', () => {
  const React = require('react')
  return {
    default: {
      View: ({ children, style }: any) => React.createElement('View', { style }, children),
    },
    View: ({ children, style }: any) => React.createElement('View', { style }, children),
    useSharedValue: (v: any) => ({ value: v }),
    useAnimatedStyle: () => ({}),
    withRepeat: (v: any) => v,
    withTiming: (v: any) => v,
    withSequence: (...args: any[]) => args[0],
    withDelay: (_: any, v: any) => v,
    FadeInDown: { delay: () => ({ duration: () => ({}) }) },
  }
})

jest.mock('react-native', () => {
  const React = require('react')
  return {
    StyleSheet: { create: (s: any) => s },
    View: ({ children, style }: any) => React.createElement('View', { style }, children),
  }
})

jest.mock('react-native-paper', () => {
  const React = require('react')
  return {
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    Card: Object.assign(
      ({ children, style, elevation }: any) => React.createElement('View', { style }, children),
      {
        Content: ({ children, style }: any) => React.createElement('View', { style }, children),
      }
    ),
    useTheme: () => ({
      colors: {
        primary: '#000',
        onSurface: '#000',
        onSurfaceVariant: '#666',
        surface: '#fff',
        surfaceVariant: '#eee',
        background: '#fff',
        secondaryContainer: '#eee',
        onSecondaryContainer: '#000',
        outlineVariant: '#ccc',
      },
    }),
  }
})

jest.mock('@expo/vector-icons', () => {
  const React = require('react')
  return {
    MaterialCommunityIcons: ({ name, size, color, style, accessible, accessibilityRole, accessibilityLabel }: any) =>
      React.createElement('MaterialCommunityIcons', {
        name, size, color, style, accessible, accessibilityRole, accessibilityLabel,
      }),
  }
})

import ComingSoonSection from '~/components/LandingPage/ComingSoonSection'

const COMING_SOON_TITLES = ['Personal Assistant', 'Wiki-Based Memory']

describe('ComingSoonSection accessibility', () => {
  let tree: any

  beforeEach(() => {
    act(() => { tree = create(<ComingSoonSection />) })
  })

  it('renders 2 feature icons', () => {
    const icons = tree.root.findAllByType('MaterialCommunityIcons')
    expect(icons.length).toBe(2)
  })

  it('each feature icon has accessibilityRole "image"', () => {
    const icons = tree.root.findAllByType('MaterialCommunityIcons')
    icons.forEach((icon: any) => {
      expect(icon.props.accessibilityRole).toBe('image')
    })
  })

  it('each feature icon has accessibilityLabel matching feature title', () => {
    const icons = tree.root.findAllByType('MaterialCommunityIcons')
    icons.forEach((icon: any, i: number) => {
      expect(icon.props.accessibilityLabel).toBe(COMING_SOON_TITLES[i])
    })
  })

  it('each feature icon has accessible=true', () => {
    const icons = tree.root.findAllByType('MaterialCommunityIcons')
    icons.forEach((icon: any) => {
      expect(icon.props.accessible).toBe(true)
    })
  })

  it('each Coming Soon badge has accessibilityLabel "Coming soon"', () => {
    const badges = tree.root.findAll((node: any) => node.props.accessibilityLabel === 'Coming soon')
    expect(badges.length).toBe(2)
    badges.forEach((badge: any) => {
      expect(badge.props.accessibilityLabel).toBe('Coming soon')
    })
  })

  it('each Coming Soon badge has accessibilityRole "text"', () => {
    const badges = tree.root.findAll((node: any) => node.props.accessibilityLabel === 'Coming soon')
    expect(badges.length).toBe(2)
    badges.forEach((badge: any) => {
      expect(badge.props.accessibilityRole).toBe('text')
    })
  })
})
