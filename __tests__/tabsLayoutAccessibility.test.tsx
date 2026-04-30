import React from 'react'
import { create, act } from 'react-test-renderer'

const capturedScreens: Array<{ name: string; options: any }> = []

jest.mock('expo-router', () => {
  const React = require('react')
  return {
    Tabs: Object.assign(
      ({ children }: any) => React.createElement('View', {}, children),
      {
        Screen: ({ name, options }: any) => {
          capturedScreens.push({ name, options })
          return React.createElement('View', { testID: `tab-${name}` })
        },
      }
    ),
    useNavigation: () => ({ setOptions: jest.fn() }),
    router: { navigate: jest.fn() },
  }
})

jest.mock('react-native', () => {
  const React = require('react')
  return {
    Alert: { alert: jest.fn() },
    View: ({ children }: any) => React.createElement('View', {}, children),
  }
})

jest.mock('~/components/navigation/TabBarIcon', () => () => null)
jest.mock('~/hooks/useEditDirtyState', () => ({
  editDirtyRef: { current: false },
  setEditDirty: jest.fn(),
}))

import TabLayout from '../app/(drawer)/(tabs)/_layout'

describe('Tabs accessibility labels', () => {
  beforeEach(() => {
    capturedScreens.length = 0
    act(() => { create(<TabLayout />) })
  })

  it('Chat tab has tabBarAccessibilityLabel', () => {
    const chat = capturedScreens.find((s) => s.name === 'chat')
    expect(chat?.options?.tabBarAccessibilityLabel).toBeDefined()
    expect(chat?.options?.tabBarAccessibilityLabel).toBe('Chat')
  })

  it('Talk tab has tabBarAccessibilityLabel', () => {
    const talk = capturedScreens.find((s) => s.name === 'talk')
    expect(talk?.options?.tabBarAccessibilityLabel).toBeDefined()
    expect(talk?.options?.tabBarAccessibilityLabel).toBe('Talk')
  })

  it('Characters tab has tabBarAccessibilityLabel', () => {
    const characters = capturedScreens.find((s) => s.name === 'characters')
    expect(characters?.options?.tabBarAccessibilityLabel).toBeDefined()
    expect(characters?.options?.tabBarAccessibilityLabel).toBe('Characters')
  })
})
