import React from 'react'
import { create, act } from 'react-test-renderer'

jest.mock('~/config/constants', () => ({
  defaultAvatarUrl: 'https://example.com/default-avatar.png',
}))

jest.mock('../assets/default-avatar-1024.webp', () => 'DEFAULT_AVATAR_ASSET', { virtual: true })

jest.mock('react-native-paper', () => {
  const React = require('react')
  return {
    Avatar: {
      Image: ({ size, source, resizeMode, onError, accessible, accessibilityLabel }: any) =>
        React.createElement('AvatarImage', {
          size,
          source,
          resizeMode,
          onError,
          accessible,
          accessibilityLabel,
        }),
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
    act(() => {
      tree = create(
        <CharacterAvatar imageUrl="https://example.com/avatar.png" characterName="Frodo" />,
      )
    })
    const avatar = tree.root.findByType('AvatarImage')
    expect(avatar.props.accessible).toBe(true)
    expect(avatar.props.accessibilityLabel).toBe('Frodo avatar')
  })

  // Regression guard for the Phase 1 divergence: the image-pipeline spec and
  // characterMachine.ts both assume a character with no image row renders the
  // bundled asset. An initials branch ahead of that fallback made it
  // unreachable, so every avatar-less character showed initials instead.
  it('renders the bundled default — not initials — when there is no image but there is a name', () => {
    let tree: any
    act(() => {
      tree = create(<CharacterAvatar imageUrl={null} characterName="Frodo Baggins" />)
    })
    expect(tree.root.findAllByType('AvatarText')).toHaveLength(0)
    const avatar = tree.root.findByType('AvatarImage')
    expect(avatar.props.source).toBe('DEFAULT_AVATAR_ASSET')
    expect(avatar.props.accessible).toBe(true)
    expect(avatar.props.accessibilityLabel).toBe('Frodo Baggins avatar')
  })

  it('bundled default fallback has accessible=true and "Character avatar" label', () => {
    let tree: any
    act(() => {
      tree = create(<CharacterAvatar imageUrl={null} characterName="" />)
    })
    const avatar = tree.root.findByType('AvatarImage')
    expect(avatar.props.accessible).toBe(true)
    expect(avatar.props.accessibilityLabel).toBe('Character avatar')
  })

  it('falls back to the bundled default asset when there is no image and no name', () => {
    let tree: any
    act(() => {
      tree = create(<CharacterAvatar imageUrl={null} characterName="" />)
    })
    const avatar = tree.root.findByType('AvatarImage')
    expect(avatar.props.source).toBe('DEFAULT_AVATAR_ASSET')
    expect(avatar.props.accessibilityLabel).toBe('Character avatar')
  })

  it('falls back to the bundled default after the remote image errors', () => {
    let tree: any
    act(() => {
      tree = create(<CharacterAvatar imageUrl="https://example.com/a.png" characterName="" />)
    })
    act(() => {
      tree.root.findByType('AvatarImage').props.onError()
    })
    expect(tree.root.findByType('AvatarImage').props.source).toBe('DEFAULT_AVATAR_ASSET')
  })

  it('covers rather than letterboxes non-square images', () => {
    let tree: any
    act(() => {
      tree = create(
        <CharacterAvatar imageUrl="https://example.com/wide.png" characterName="Frodo" />,
      )
    })
    expect(tree.root.findByType('AvatarImage').props.resizeMode).toBe('cover')
  })
})
