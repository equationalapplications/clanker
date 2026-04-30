import React from 'react'
import { create, act } from 'react-test-renderer'

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ characterId: 'char-1' }),
  Stack: Object.assign(
    ({ children }: any) => {
      const React = require('react')
      return React.createElement('View', {}, children)
    },
    {
      Screen: ({ options }: any) => {
        const React = require('react')
        return React.createElement('View', {})
      },
    }
  ),
  router: { push: jest.fn() },
  useFocusEffect: jest.fn(),
}))

jest.mock('~/hooks/useCharacters', () => ({
  useCharacter: () => ({
    data: { id: 'char-1', name: 'Frodo', avatar: null },
    isLoading: false,
  }),
  useCharacters: () => ({
    characters: [{ id: 'char-1', name: 'Frodo', avatar: null }],
    isLoading: false,
  }),
}))

jest.mock('~/hooks/useMessages', () => ({
  useMostRecentMessage: () => ({ data: { character_id: 'char-1' }, isLoading: false }),
}))

jest.mock('~/hooks/useVoiceChat', () => ({
  useVoiceChat: () => ({
    voiceState: 'idle',
    transcription: '',
    replyText: '',
    error: null,
    startListening: jest.fn(),
    cancel: jest.fn(),
  }),
}))

jest.mock('~/hooks/useMachines', () => ({
  useCharacterMachine: jest.fn(),
}))

jest.mock('@xstate/react', () => ({
  useSelector: (_: any, sel: any) => sel({ matches: () => false }),
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
    View: ({ children, style, accessibilityRole, accessibilityLiveRegion }: any) =>
      React.createElement('View', { style, accessibilityRole, accessibilityLiveRegion }, children),
    Pressable: ({ children, onPress, disabled, style, accessibilityRole, accessibilityLabel, accessibilityState }: any) =>
      React.createElement('Pressable', { onPress, disabled, style, accessibilityRole, accessibilityLabel, accessibilityState }, children),
    ActivityIndicator: ({ size, style }: any) => React.createElement('ActivityIndicator', { size, style }),
  }
})

jest.mock('@expo/vector-icons', () => ({
  MaterialCommunityIcons: () => null,
}))

jest.mock('~/components/CharacterAvatar', () => () => null)

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: jest.fn(),
}))

jest.mock('react-native-paper', () => {
  const React = require('react')
  return {
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
  }
})

import TalkTabScreen from '../app/(drawer)/(tabs)/talk/index'

describe('Talk screen status region', () => {
  it('statusWrap View has accessibilityLiveRegion "polite"', () => {
    let tree: any
    act(() => { tree = create(<TalkTabScreen />) })

    const allViews = tree.root.findAll((node: any) => node.type === 'View')
    const liveRegionView = allViews.find((v: any) => v.props.accessibilityLiveRegion === 'polite')
    expect(liveRegionView).toBeDefined()
  })

  it('statusWrap View has accessibilityRole "status"', () => {
    let tree: any
    act(() => { tree = create(<TalkTabScreen />) })

    const allViews = tree.root.findAll((node: any) => node.type === 'View')
    const statusView = allViews.find((v: any) => v.props.accessibilityRole === 'status')
    expect(statusView).toBeDefined()
  })
})
