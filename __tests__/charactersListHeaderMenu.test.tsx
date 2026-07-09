import React from 'react'
import renderer, { act } from 'react-test-renderer'

// ---- react-native ----
jest.mock('react-native', () => {
  const React = require('react')
  return {
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
    StyleSheet: { create: (s: any) => s },
    Platform: { OS: 'ios', select: (opts: any) => opts.ios ?? opts.default },
    FlatList: ({ data = [], renderItem, ListEmptyComponent }: any) =>
      React.createElement(
        'FlatList',
        null,
        data.length
          ? data.map((item: any, i: number) =>
              React.createElement('Row', { key: i }, renderItem({ item })),
            )
          : ListEmptyComponent ?? null,
      ),
  }
})

// ---- react-native-paper (Menu mock renders items only when visible) ----
jest.mock('react-native-paper', () => {
  const React = require('react')
  return {
    Text: ({ children }: any) => React.createElement('Text', null, children),
    Button: ({ children, disabled, onPress }: any) =>
      React.createElement('Button', { disabled, onPress }, children),
    ActivityIndicator: () => null,
    Snackbar: ({ visible, children }: any) =>
      visible ? React.createElement('Snackbar', null, children) : null,
    IconButton: ({ icon, onPress, disabled, loading, accessibilityLabel }: any) =>
      React.createElement('IconButton', {
        icon,
        onPress,
        disabled,
        loading,
        accessibilityLabel,
      }),
    Portal: ({ children }: any) => React.createElement('Portal', null, children),
    Modal: ({ visible, children }: any) =>
      visible ? React.createElement('Modal', null, children) : null,
    useTheme: () => ({ colors: { surface: '#fff' } }),
    Menu: Object.assign(
      ({ visible, children, anchor }: any) =>
        React.createElement('Menu', { visible }, anchor, visible ? children : null),
      {
        Item: ({ title, onPress }: any) =>
          React.createElement('MenuItem', { onPress, title }, title),
      },
    ),
  }
})

// ---- expo-router ----
jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
}))

// ---- @xstate/react: run the selector against the actor snapshot ----
jest.mock('@xstate/react', () => ({
  useSelector: (actor: any, selector: any) => selector(actor.getSnapshot()),
}))

// ---- machines ----
jest.mock('~/hooks/useMachines', () => ({
  useCharacterMachine: () => ({
    send: jest.fn(),
    getSnapshot: () => ({ matches: () => false }),
  }),
  useAuthMachine: () => ({
    send: jest.fn(),
    getSnapshot: () => ({ context: { user: { uid: 'user-1' } } }),
  }),
}))

// ---- character hooks (mutable per test) ----
const mockSync = jest.fn()
const mockCreate = jest.fn()
let mockIsCloudSyncing = false
jest.mock('~/hooks/useCharacters', () => ({
  useCharacters: () => ({ characters: [], isLoading: false }),
  useCreateCharacter: () => ({ create: mockCreate, isPending: false, pendingCharacterId: null }),
  useSyncCharacters: () => ({ sync: mockSync, isCloudSyncing: mockIsCloudSyncing, error: null }),
}))

// ---- import hook ----
const mockPickAndPreview = jest.fn()
jest.mock('~/hooks/useImportCharacterOKF', () => ({
  useImportCharacterOKF: () => ({
    preview: null,
    isParsing: false,
    isImporting: false,
    error: null,
    handlePickAndPreview: mockPickAndPreview,
    handleCommitImport: jest.fn(),
    handleCancel: jest.fn(),
  }),
}))

// ---- misc deps ----
jest.mock('~/components/CharacterCard', () => ({ CharacterCard: () => null }))
jest.mock('~/database/characterDatabase', () => ({ createCharacter: jest.fn() }))
jest.mock('~/services/characterService', () => ({ deleteCharacter: jest.fn() }))
jest.mock('~/utilities/reportError', () => ({ reportError: jest.fn() }))

import CharactersListScreen from '../app/(drawer)/(tabs)/characters/list'

// Test helpers -------------------------------------------------------------

type El = renderer.ReactTestInstance

function findByType(root: El, type: string): El[] {
  return root.findAll((n) => n.type === type)
}

function kebab(root: El): El {
  return findByType(root, 'IconButton').find(
    (n) => n.props.accessibilityLabel === 'More actions',
  )!
}

function menuItems(root: El): El[] {
  return findByType(root, 'MenuItem')
}

beforeEach(() => {
  jest.clearAllMocks()
  mockIsCloudSyncing = false
})

describe('CharactersListScreen header overflow menu', () => {
  it('renders a kebab that opens a menu with Cloud Sync and Import items', () => {
    let tree: renderer.ReactTestRenderer
    act(() => {
      tree = renderer.create(<CharactersListScreen />)
    })
    const root = tree!.root

    // Menu closed initially -> no items rendered.
    expect(menuItems(root)).toHaveLength(0)

    act(() => {
      kebab(root).props.onPress()
    })

    const titles = menuItems(root).map((n) => n.props.title)
    expect(titles).toEqual(['Cloud Sync', 'Import from Bundle'])
  })

  it('Cloud Sync item closes the menu, shows a toast, and triggers sync', () => {
    let tree: renderer.ReactTestRenderer
    act(() => {
      tree = renderer.create(<CharactersListScreen />)
    })
    const root = tree!.root

    act(() => kebab(root).props.onPress())
    const cloudSync = menuItems(root).find((n) => n.props.title === 'Cloud Sync')!
    act(() => cloudSync.props.onPress())

    expect(mockSync).toHaveBeenCalledTimes(1)
    expect(menuItems(root)).toHaveLength(0) // menu closed
    const snackbar = findByType(root, 'Snackbar')[0]
    expect(snackbar).toBeTruthy()
  })

  it('Import item closes the menu, shows a toast, and starts the import flow', () => {
    let tree: renderer.ReactTestRenderer
    act(() => {
      tree = renderer.create(<CharactersListScreen />)
    })
    const root = tree!.root

    act(() => kebab(root).props.onPress())
    const importItem = menuItems(root).find((n) => n.props.title === 'Import from Bundle')!
    act(() => importItem.props.onPress())

    expect(mockPickAndPreview).toHaveBeenCalledTimes(1)
    expect(menuItems(root)).toHaveLength(0)
    expect(findByType(root, 'Snackbar')[0]).toBeTruthy()
  })

  it('disables the kebab and shows its loading state while syncing', () => {
    mockIsCloudSyncing = true
    let tree: renderer.ReactTestRenderer
    act(() => {
      tree = renderer.create(<CharactersListScreen />)
    })
    const k = kebab(tree!.root)
    expect(k.props.disabled).toBe(true)
    expect(k.props.loading).toBe(true)
  })
})
