import React from 'react'
import { create, act } from 'react-test-renderer'

const liveVoiceReturn: Record<string, unknown> = {}

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ characterId: 'char-1' }),
  router: { push: jest.fn() },
  useFocusEffect: jest.fn(),
}))
jest.mock('~/hooks/useCharacters', () => ({
  useCharacter: () => ({ data: { id: 'char-1', name: 'Frodo', avatar: null }, isLoading: false }),
}))
jest.mock('~/hooks/useTabCharacterId', () => ({
  useTabCharacterId: () => ({ characterId: 'char-1', isLoading: false, isCreatingDefault: false }),
}))
jest.mock('~/hooks/useLiveVoiceChat', () => ({
  useLiveVoiceChat: () => liveVoiceReturn,
}))
jest.mock('~/hooks/useMachines', () => ({ useCharacterMachine: jest.fn() }))
jest.mock('@xstate/react', () => ({
  useSelector: (_: any, sel: any) => sel({ matches: () => false }),
}))
jest.mock('react-native-reanimated', () => {
  const React = require('react')
  return {
    __esModule: true,
    default: { View: ({ children, style }: any) => React.createElement('View', { style }, children) },
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
    Platform: { OS: 'android' },
    Linking: { openURL: jest.fn() },
    TouchableOpacity: ({ children, ...p }: any) => React.createElement('TouchableOpacity', p, children),
    View: ({ children, ...p }: any) => React.createElement('View', p, children),
    Pressable: ({ children, ...p }: any) => React.createElement('Pressable', p, children),
    ActivityIndicator: ({ size, style }: any) => React.createElement('ActivityIndicator', { size, style }),
  }
})
jest.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }))
jest.mock('~/components/CharacterAvatar', () => () => null)
jest.mock('~/components/GroundingHtml', () => ({ GroundingHtml: () => null }))
jest.mock('expo-router/react-navigation', () => ({
  useFocusEffect: jest.fn(),
  useNavigation: () => ({
    navigate: jest.fn(),
    goBack: jest.fn(),
    addListener: jest.fn().mockReturnValue(jest.fn()),
    getParent: () => ({ getParent: () => ({ setOptions: jest.fn() }) }),
  }),
}))
jest.mock('react-native-paper', () => {
  const React = require('react')
  return { Text: ({ children, ...props }: any) => React.createElement('Text', props, children) }
})

import TalkTabScreen from '../app/(drawer)/(tabs)/talk/index'

function baseReturn(overrides: Record<string, unknown>) {
  return {
    isConnecting: false,
    isLive: false,
    isSyncing: false,
    syncPhase: null,
    error: null,
    transcript: [],
    activeTool: null,
    groundingMetadata: null,
    remainingCredits: 10,
    isPlayingAudio: false,
    startCall: jest.fn(),
    endCall: jest.fn(),
    cancelCall: jest.fn(),
    ...overrides,
  }
}

function findCreditNode(tree: any) {
  return tree.root
    .findAll((n: any) => n.type === 'Text')
    .find(
      (n: any) =>
        typeof n.props.accessibilityLabel === 'string' &&
        n.props.accessibilityLabel.endsWith(' remaining'),
    )
}

describe('Talk screen credit indicator', () => {
  it('hides the credit count when not in a call', () => {
    Object.assign(liveVoiceReturn, baseReturn({ isLive: false, isConnecting: false }))
    let tree: any
    act(() => { tree = create(<TalkTabScreen />) })
    expect(findCreditNode(tree)).toBeUndefined()
  })

  it('shows the credit count while live', () => {
    Object.assign(liveVoiceReturn, baseReturn({ isLive: true, remainingCredits: 8 }))
    let tree: any
    act(() => { tree = create(<TalkTabScreen />) })
    const node = findCreditNode(tree)
    expect(node).toBeDefined()
    expect(node.props.children).toBe('8 credits')
    expect(node.props.accessibilityLabel).toBe('8 credits remaining')
  })

  it('uses singular credit copy for a count of one', () => {
    Object.assign(liveVoiceReturn, baseReturn({ isLive: true, remainingCredits: 1 }))
    let tree: any
    act(() => { tree = create(<TalkTabScreen />) })
    const node = findCreditNode(tree)
    expect(node).toBeDefined()
    expect(node.props.children).toBe('1 credit')
    expect(node.props.accessibilityLabel).toBe('1 credit remaining')
  })

  it('applies low-credit emphasis at or below the threshold', () => {
    Object.assign(liveVoiceReturn, baseReturn({ isLive: true, remainingCredits: 3 }))
    let tree: any
    act(() => { tree = create(<TalkTabScreen />) })
    const node = findCreditNode(tree)
    expect((node.props.style as unknown[]).filter(Boolean)).toHaveLength(2)
  })

  it('applies no emphasis above the threshold', () => {
    Object.assign(liveVoiceReturn, baseReturn({ isLive: true, remainingCredits: 8 }))
    let tree: any
    act(() => { tree = create(<TalkTabScreen />) })
    const node = findCreditNode(tree)
    expect((node.props.style as unknown[]).filter(Boolean)).toHaveLength(1)
  })
})
