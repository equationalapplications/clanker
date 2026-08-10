import React from 'react'
import { render, fireEvent } from '@testing-library/react-native'

const capturedImageProps: any[] = []
const capturedTextProps: any[] = []

jest.mock('react-native-paper', () => {
  const React = require('react')
  return {
    Avatar: {
      Image: (props: any) => {
        capturedImageProps.push(props)
        return React.createElement('View', { testID: 'avatar-img', ...props })
      },
      Text: (props: any) => {
        capturedTextProps.push(props)
        return React.createElement('View', { testID: 'avatar-text', ...props })
      },
    },
  }
})

import CharacterAvatar, { DEFAULT_AVATAR } from '~/components/CharacterAvatar'

describe('CharacterAvatar bundled-default contract', () => {
  beforeEach(() => {
    capturedImageProps.length = 0
    capturedTextProps.length = 0
  })

  it('renders the bundled default when imageUrl is null', () => {
    render(<CharacterAvatar imageUrl={null} characterName="Test" />)
    expect(capturedImageProps).toHaveLength(1)
    expect(capturedImageProps[0].source).toBe(DEFAULT_AVATAR)
    expect(capturedImageProps[0].accessibilityLabel).toBe('Test avatar')
  })

  it('renders the bundled default when imageUrl is undefined', () => {
    render(<CharacterAvatar />)
    expect(capturedImageProps).toHaveLength(1)
    expect(capturedImageProps[0].source).toBe(DEFAULT_AVATAR)
  })

  it('renders the supplied uri when imageUrl is provided', () => {
    render(<CharacterAvatar imageUrl="https://example.com/test.png" characterName="Test" />)
    expect(capturedImageProps).toHaveLength(1)
    expect(capturedImageProps[0].source).toEqual({ uri: 'https://example.com/test.png' })
    expect(capturedImageProps[0].accessibilityRole).toBe('image')
  })

  // Guards the deliberate removal of the initials branch in phase 1 §4.1.
  // An avatar-less character with a name used to render initials above the
  // bundled default; the fallback chain must terminate at the bundled default.
  it('does not render initials when characterName is set but imageUrl is null', () => {
    render(<CharacterAvatar imageUrl={null} characterName="Test" />)
    expect(capturedImageProps).toHaveLength(1)
    expect(capturedTextProps).toHaveLength(0)
  })

  // The erroredUrl branch (CharacterAvatar.tsx:39-43, 55-57). A dead remote
  // URL must degrade to the bundled default, not to a broken image box.
  it('falls back to the bundled default after the supplied uri fails to load', () => {
    const { getByTestId } = render(
      <CharacterAvatar imageUrl="https://example.com/dead.png" characterName="Test" />,
    )
    fireEvent(getByTestId('avatar-img'), 'error')
    expect(capturedImageProps[capturedImageProps.length - 1].source).toBe(DEFAULT_AVATAR)
    expect(capturedTextProps).toHaveLength(0)
  })

  // Derived-state reset: imageError is keyed to the URL that failed, so a new
  // URL must be attempted rather than inheriting the previous failure.
  it('retries when imageUrl changes after an error', () => {
    const { getByTestId, rerender } = render(
      <CharacterAvatar imageUrl="https://example.com/dead.png" characterName="Test" />,
    )
    fireEvent(getByTestId('avatar-img'), 'error')
    rerender(<CharacterAvatar imageUrl="https://example.com/fresh.png" characterName="Test" />)
    expect(capturedImageProps[capturedImageProps.length - 1].source).toEqual({
      uri: 'https://example.com/fresh.png',
    })
  })

  it('sets the image accessibility role on the bundled-default branch', () => {
    render(<CharacterAvatar characterName="Test" />)
    expect(capturedImageProps[0].accessibilityRole).toBe('image')
  })
})
