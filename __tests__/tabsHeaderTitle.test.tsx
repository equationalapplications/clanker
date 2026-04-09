import React from 'react'
import renderer from 'react-test-renderer'
import { Alert } from 'react-native'

const mockSetOptions = jest.fn()

jest.mock('expo-router', () => {
  const React = require('react')

  const Tabs = ({ children }: { children: React.ReactNode }) => <>{children}</>
  Tabs.Screen = () => null

  return {
    Tabs,
    router: {
      navigate: jest.fn(),
    },
    useNavigation: () => ({
      setOptions: mockSetOptions,
    }),
  }
})

jest.mock('~/components/navigation/TabBarIcon', () => ({
  TabBarIcon: () => null,
}))

jest.mock('~/hooks/useEditDirtyState', () => ({
  editDirtyRef: { current: false },
  setEditDirty: jest.fn(),
}))

describe('tabs layout header title', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.spyOn(Alert, 'alert').mockImplementation(jest.fn())
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('sets the parent header title to Chat', () => {
    const TabLayout = require('../app/(drawer)/(tabs)/_layout').default

    renderer.act(() => {
      renderer.create(<TabLayout />)
    })

    expect(mockSetOptions).toHaveBeenCalledTimes(1)
    expect(mockSetOptions).toHaveBeenCalledWith({ headerTitle: 'Chat' })
  })
})
