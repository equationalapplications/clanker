import React from 'react'
import { create, act } from 'react-test-renderer'

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
}))

jest.mock('~/components/CharacterAvatar', () => {
  const React = require('react')
  return () => React.createElement('View', { testID: 'avatar' })
})

jest.mock('react-native', () => {
  const React = require('react')
  return {
    StyleSheet: { create: (s: any) => s },
    View: ({ children, style }: any) => React.createElement('View', { style }, children),
    TouchableOpacity: ({ children, onPress, accessibilityRole, accessibilityLabel, accessibilityHint, style, hitSlop }: any) =>
      React.createElement('TouchableOpacity', { onPress, accessibilityRole, accessibilityLabel, accessibilityHint, style, hitSlop }, children),
  }
})

jest.mock('react-native-paper', () => {
  const React = require('react')
  return {
    Card: Object.assign(
      ({ children, style, mode }: any) => React.createElement('View', { style }, children),
      {
        Content: ({ children, style }: any) => React.createElement('View', { style }, children),
      }
    ),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    Icon: ({ source, size }: any) => React.createElement('View', { testID: `icon-${source}` }),
    useTheme: () => ({ colors: { onSurfaceVariant: '#666' } }),
  }
})

import { CharacterCard } from '~/components/CharacterCard'

describe('CharacterCard accessibility', () => {
  const defaultProps = {
    id: 'char-1',
    name: 'Frodo',
    appearance: 'A brave hobbit',
  }

  it('outer card button has accessibilityRole "button"', () => {
    let tree: any
    act(() => { tree = create(<CharacterCard {...defaultProps} />) })
    const touchables = tree.root.findAllByType('TouchableOpacity')
    expect(touchables[0].props.accessibilityRole).toBe('button')
  })

  it('outer card label includes character name and appearance', () => {
    let tree: any
    act(() => { tree = create(<CharacterCard {...defaultProps} />) })
    const touchables = tree.root.findAllByType('TouchableOpacity')
    expect(touchables[0].props.accessibilityLabel).toContain('Frodo')
    expect(touchables[0].props.accessibilityLabel).toContain('A brave hobbit')
  })

  it('outer card label falls back when appearance missing', () => {
    let tree: any
    act(() => { tree = create(<CharacterCard {...defaultProps} appearance={undefined} />) })
    const touchables = tree.root.findAllByType('TouchableOpacity')
    expect(touchables[0].props.accessibilityLabel).toContain('No description available')
  })

  it('outer card has accessibilityHint "Opens chat with this character"', () => {
    let tree: any
    act(() => { tree = create(<CharacterCard {...defaultProps} />) })
    const touchables = tree.root.findAllByType('TouchableOpacity')
    expect(touchables[0].props.accessibilityHint).toBe('Opens chat with this character')
  })

  it('edit button has accessibilityRole "button"', () => {
    let tree: any
    act(() => { tree = create(<CharacterCard {...defaultProps} />) })
    const touchables = tree.root.findAllByType('TouchableOpacity')
    expect(touchables[1].props.accessibilityRole).toBe('button')
  })

  it('edit button label includes character name', () => {
    let tree: any
    act(() => { tree = create(<CharacterCard {...defaultProps} />) })
    const touchables = tree.root.findAllByType('TouchableOpacity')
    expect(touchables[1].props.accessibilityLabel).toBe('Edit Frodo')
  })

  it('edit button has accessibilityHint "Opens character editor"', () => {
    let tree: any
    act(() => { tree = create(<CharacterCard {...defaultProps} />) })
    const touchables = tree.root.findAllByType('TouchableOpacity')
    expect(touchables[1].props.accessibilityHint).toBe('Opens character editor')
  })
})
