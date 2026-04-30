import React from 'react'
import { create, act } from 'react-test-renderer'

jest.mock('~/config/constants', () => ({
  defaultAvatarUrl: 'https://example.com/default-avatar.png',
}))

jest.mock('react-native-paper', () => {
  const React = require('react')
  return {
    Avatar: {
      Image: ({ size, source, onError, accessible, accessibilityLabel }: any) =>
        React.createElement('AvatarImage', { size, source, onError, accessible, accessibilityLabel }),
      Text: ({ size, label, accessible, accessibilityLabel }: any) =>
        React.createElement('AvatarText', { size, label, accessible, accessibilityLabel }),
      Icon: ({ size, icon, accessible, accessibilityLabel }: any) =>
        React.createElement('AvatarIcon', { size, icon, accessible, accessibilityLabel }),
    },
  }
})

import CharacterAvatar from '~/components/CharacterAvatar'

describe('CharacterAvatar accessibility', () => {
  it('Avatar.Image with imageUrl has accessible=true and label', () => {
    let tree: any
    act(() => { tree = create(<CharacterAvatar imageUrl="https://example.com/avatar.png" characterName="Frodo" />) })
    const avatar = tree.root.findByType('AvatarImage')
    expect(avatar.props.accessible).toBe(true)
    expect(avatar.props.accessibilityLabel).toBe('Frodo avatar')
  })

  it('Avatar.Text (initials) has accessible=true and label', () => {
    let tree: any
    act(() => { tree = create(<CharacterAvatar imageUrl={null} characterName="Frodo Baggins" />) })
    const avatar = tree.root.findByType('AvatarText')
    expect(avatar.props.accessible).toBe(true)
    expect(avatar.props.accessibilityLabel).toBe('Frodo Baggins avatar')
  })

  it('Avatar.Icon fallback has accessible=true and "Character avatar" label', () => {
    let tree: any
    act(() => { tree = create(<CharacterAvatar imageUrl={null} characterName="" />) })
    const avatar = tree.root.findByType('AvatarIcon')
    expect(avatar.props.accessible).toBe(true)
    expect(avatar.props.accessibilityLabel).toBe('Character avatar')
  })

  it('Avatar.Image default gravatar fallback has label', () => {
    let tree: any
    act(() => { tree = create(<CharacterAvatar imageUrl={null} characterName="" showFallback={false} />) })
    const avatar = tree.root.findByType('AvatarImage')
    expect(avatar.props.accessible).toBe(true)
    expect(avatar.props.accessibilityLabel).toBe('Character avatar')
  })
})
