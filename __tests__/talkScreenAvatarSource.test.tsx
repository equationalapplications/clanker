/**
 * Avatar source precedence for the Talk screen's header and body avatars.
 *
 * Chain: resolved(active_image_id) → bundled default. The legacy
 * `characters.avatar` tail fallback was removed when the column was dropped; a
 * missing resolve now goes straight to the bundled default. The header goes
 * through drawerNav.setOptions, so it is captured and rendered separately; the
 * body avatar is in the main tree.
 */

import React from 'react'
import { render } from '@testing-library/react-native'

let mockCharacter: Record<string, unknown> = {}

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
}))

jest.mock('~/hooks/useCharacters', () => ({
  useCharacter: () => ({ data: mockCharacter, isLoading: false }),
}))

jest.mock('~/hooks/useTabCharacterId', () => ({
  useTabCharacterId: () => ({
    characterId: 'char-1',
    isLoading: false,
    isCreatingDefault: false,
  }),
}))

jest.mock('~/hooks/useLiveVoiceChat', () => ({
  useLiveVoiceChat: () => ({
    isConnecting: false,
    isLive: false,
    isSyncing: false,
    error: null,
    transcript: [],
    activeTool: null,
    groundingMetadata: null,
    isPlayingAudio: false,
    startCall: jest.fn(),
    endCall: jest.fn(),
    cancelCall: jest.fn(),
  }),
}))

jest.mock('~/components/GroundingHtml', () => ({
  GroundingHtml: () => null,
}))

jest.mock('react-native-reanimated', () => {
  const React = require('react')
  return {
    __esModule: true,
    default: {
      View: ({ children, style }: any) => React.createElement('View', { style }, children),
    },
    useSharedValue: (v: any) => ({ value: v }),
    useAnimatedStyle: () => ({}),
    withRepeat: (v: any) => v,
    withTiming: (v: any) => v,
    cancelAnimation: jest.fn(),
    Easing: { inOut: () => ({}), ease: {} },
  }
})

jest.mock('react-native', () => {
  const React = require('react')
  return {
    StyleSheet: { create: (s: any) => s },
    Platform: { OS: 'web' },
    View: ({ children, style, accessibilityRole, accessibilityLabel, testID }: any) =>
      React.createElement(
        'View',
        { style, accessibilityRole, accessibilityLabel, testID },
        children,
      ),
    Pressable: ({
      children,
      onPress,
      disabled,
      style,
      accessibilityRole,
      accessibilityLabel,
    }: any) =>
      React.createElement(
        'Pressable',
        { onPress, disabled, style, accessibilityRole, accessibilityLabel },
        children,
      ),
    TouchableOpacity: ({ children, onPress, accessibilityRole, accessibilityLabel }: any) =>
      React.createElement(
        'TouchableOpacity',
        { onPress, accessibilityRole, accessibilityLabel },
        children,
      ),
    ActivityIndicator: ({ size, style }: any) =>
      React.createElement('ActivityIndicator', { size, style }),
    Linking: { openURL: jest.fn() },
  }
})

jest.mock('@expo/vector-icons', () => ({
  MaterialCommunityIcons: () => null,
}))

// ── The pipeline under test ───────────────────────────────────────────────────
let mockResolved: string | null = null
const mockUseResolvedImage: jest.Mock = jest.fn(() => ({ uri: mockResolved, isResolved: true }))
jest.mock('~/hooks/useResolvedImage', () => ({
  useResolvedImage: (...args: any[]) => mockUseResolvedImage(...args),
}))

const capturedAvatarProps: any[] = []
jest.mock('~/components/CharacterAvatar', () => ({
  __esModule: true,
  default: (props: any) => {
    capturedAvatarProps.push(props)
    return null
  },
}))

let capturedHeaderTitle: (() => React.ReactElement) | null = null

// Referentially stable: the Talk screen's useLayoutEffect lists `navigation` in
// its deps, so a fresh object per render would retrigger the effect every time
// and make the dependency-array guard below vacuous.
const mockNavigation = {
  addListener: jest.fn(() => jest.fn()),
  getParent: () => ({
    getParent: () => ({
      setOptions: (opts: any) => {
        if (typeof opts?.headerTitle === 'function') capturedHeaderTitle = opts.headerTitle
      },
    }),
  }),
}

jest.mock('expo-router/react-navigation', () => ({
  useNavigation: () => mockNavigation,
}))

jest.mock('react-native-paper', () => {
  const React = require('react')
  return {
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
  }
})

import TalkTabScreen from '../app/(drawer)/(tabs)/talk/index'

function baseCharacter(overrides: Record<string, unknown>) {
  return {
    id: 'char-1',
    name: 'Frodo',
    active_image_id: null,
    voice: 'Aoede',
    save_to_cloud: 1,
    ...overrides,
  }
}

function renderTalk(character: Record<string, unknown>) {
  mockCharacter = character
  return render(<TalkTabScreen />)
}

/** Body avatar props — the header renders separately via setOptions. */
function bodyAvatarProps() {
  return capturedAvatarProps[capturedAvatarProps.length - 1]
}

function headerAvatarProps() {
  expect(capturedHeaderTitle).toBeTruthy()
  const before = capturedAvatarProps.length
  render(capturedHeaderTitle!())
  return capturedAvatarProps[before]
}

describe('Talk screen avatar source', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    capturedAvatarProps.length = 0
    capturedHeaderTitle = null
    mockResolved = null
  })

  it('body avatar prefers the resolved master when a row is present', () => {
    mockResolved = 'file:///new-master.webp'
    renderTalk(baseCharacter({ active_image_id: 'img-1' }))

    expect(mockUseResolvedImage).toHaveBeenCalledWith('img-1', 'master')
    expect(bodyAvatarProps().imageUrl).toBe('file:///new-master.webp')
  })

  it('body avatar passes null when nothing resolves', () => {
    mockResolved = null
    renderTalk(baseCharacter({}))

    expect(bodyAvatarProps().imageUrl).toBeNull()
  })

  it('header avatar requests the thumb variant and prefers the resolved image', () => {
    mockResolved = 'file:///new-thumb.webp'
    renderTalk(baseCharacter({ active_image_id: 'img-1' }))

    expect(mockUseResolvedImage).toHaveBeenCalledWith('img-1', 'thumb')
    expect(headerAvatarProps().imageUrl).toBe('file:///new-thumb.webp')
  })

  // Guards the useLayoutEffect dependency array. The resolve is async, so the
  // header is first installed with null. `character` is the same object across
  // both renders, so only the resolved uri can retrigger the effect — drop it
  // from the deps and the header keeps showing the bundled default forever.
  it('reinstalls the header when the resolved image arrives after first render', () => {
    mockResolved = null
    const character = baseCharacter({ active_image_id: 'img-1' })
    const tree = renderTalk(character)

    expect(headerAvatarProps().imageUrl).toBeNull()

    mockResolved = 'file:///late-thumb.webp'
    tree.rerender(<TalkTabScreen />)

    expect(headerAvatarProps().imageUrl).toBe('file:///late-thumb.webp')
  })
})
