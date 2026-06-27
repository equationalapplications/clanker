import React from 'react'
import { create, act } from 'react-test-renderer'

const mockGroundingHtmlProps: Array<{ html: string }> = []

let mockGroundingMetadata: unknown = null

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
}))

jest.mock('~/hooks/useCharacters', () => ({
  useCharacter: () => ({
    data: { id: 'char-1', name: 'Frodo', avatar: null, voice: 'Aoede', save_to_cloud: 1 },
    isLoading: false,
  }),
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
    isLive: true,
    isSyncing: false,
    error: null,
    transcript: [],
    activeTool: null,
    groundingMetadata: mockGroundingMetadata,
    isPlayingAudio: false,
    startCall: jest.fn(),
    endCall: jest.fn(),
    cancelCall: jest.fn(),
  }),
}))

jest.mock('~/components/GroundingHtml', () => ({
  GroundingHtml: (props: { html: string }) => {
    mockGroundingHtmlProps.push(props)
    const React = require('react')
    return React.createElement('GroundingHtml', { testID: 'grounding-html', html: props.html })
  },
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
      React.createElement('View', { style, accessibilityRole, accessibilityLabel, testID }, children),
    Pressable: ({ children, onPress, disabled, style, accessibilityRole, accessibilityLabel }: any) =>
      React.createElement('Pressable', { onPress, disabled, style, accessibilityRole, accessibilityLabel }, children),
    TouchableOpacity: ({ children, onPress, accessibilityRole, accessibilityLabel }: any) =>
      React.createElement('TouchableOpacity', { onPress, accessibilityRole, accessibilityLabel }, children),
    ActivityIndicator: ({ size, style }: any) => React.createElement('ActivityIndicator', { size, style }),
    Linking: { openURL: jest.fn() },
  }
})

jest.mock('@expo/vector-icons', () => ({
  MaterialCommunityIcons: () => null,
}))

jest.mock('~/components/CharacterAvatar', () => () => null)

jest.mock('expo-router/react-navigation', () => ({
  useNavigation: () => ({
    addListener: jest.fn(() => jest.fn()),
    getParent: () => ({
      getParent: () => ({ setOptions: jest.fn() }),
    }),
  }),
}))

jest.mock('react-native-paper', () => {
  const React = require('react')
  return {
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
  }
})

import TalkTabScreen from '../app/(drawer)/(tabs)/talk/index'

function renderTalkScreen() {
  let tree: any
  act(() => {
    tree = create(<TalkTabScreen />)
  })
  return tree
}

describe('Talk screen grounding display', () => {
  beforeEach(() => {
    mockGroundingMetadata = null
    mockGroundingHtmlProps.length = 0
  })

  it('renders nothing when groundingMetadata is null', () => {
    const tree = renderTalkScreen()
    expect(tree.root.findAllByProps({ testID: 'grounding-html' })).toHaveLength(0)
  })

  it('passes Google searchEntryPoint HTML verbatim to GroundingHtml', () => {
    const googleHtml =
      '<style>.gs-chip{color:#1a73e8}</style><div class="gs-chip">Try searching</div>'
    mockGroundingMetadata = {
      searchEntryPoint: { renderedContent: googleHtml },
    }

    renderTalkScreen()

    expect(mockGroundingHtmlProps).toHaveLength(1)
    expect(mockGroundingHtmlProps[0]!.html).toBe(googleHtml)
  })

  it('renders citation chips for safe http(s) groundingChunks', () => {
    mockGroundingMetadata = {
      groundingChunks: [
        { web: { uri: 'https://example.com', title: 'Example Source' } },
        { web: { uri: 'javascript:alert(1)', title: 'Unsafe' } },
      ],
    }

    const tree = renderTalkScreen()

    const safeChip = tree.root.find(
      (node: any) => node.props.accessibilityLabel === 'Example Source',
    )
    expect(safeChip).toBeDefined()

    const unsafeChip = tree.root.findAll(
      (node: any) => node.props.accessibilityLabel === 'Unsafe',
    )
    expect(unsafeChip).toHaveLength(0)
  })

  it('renders both citation chips and Google HTML when both are present', () => {
    const googleHtml = '<div>Suggestions</div>'
    mockGroundingMetadata = {
      groundingChunks: [{ web: { uri: 'https://news.example.com', title: 'News Article' } }],
      searchEntryPoint: { renderedContent: googleHtml },
    }

    const tree = renderTalkScreen()

    expect(mockGroundingHtmlProps[0]!.html).toBe(googleHtml)
    expect(
      tree.root.find((node: any) => node.props.accessibilityLabel === 'News Article'),
    ).toBeDefined()
  })
})
