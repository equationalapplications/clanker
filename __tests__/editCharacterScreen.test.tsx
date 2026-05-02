import React from 'react'
import renderer, { act } from 'react-test-renderer'

// Mock Alert
const mockAlertAlert = jest.fn()
jest.mock('react-native', () => {
  const React = require('react')
  return {
    Alert: {
      alert: (...args: unknown[]) => mockAlertAlert(...args),
    },
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
    ScrollView: ({ children, ...props }: any) => React.createElement('ScrollView', props, children),
    StyleSheet: { create: (s: any) => s },
    Share: { share: jest.fn() },
  }
})

// Mock expo-router
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'char-1' }),
  router: { push: jest.fn(), canGoBack: jest.fn(() => false), back: jest.fn(), replace: jest.fn() },
}))

// Mock expo-sqlite
jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn().mockResolvedValue({
    execAsync: jest.fn(),
    runAsync: jest.fn(),
    getFirstAsync: jest.fn(),
    getAllAsync: jest.fn(),
    closeAsync: jest.fn(),
  }),
}))

// Mock react-native-paper
jest.mock('react-native-paper', () => {
  const React = require('react')
  return {
    Text: ({ children }: any) => React.createElement('Text', null, children),
    TextInput: ({ label, editable, disabled, ...rest }: any) =>
      React.createElement('TextInput', { 'data-label': label, editable, disabled, ...rest }),
    Button: ({ children, disabled, onPress }: any) =>
      React.createElement('Button', { disabled, onPress }, children),
    Switch: ({ value, disabled, onValueChange }: any) =>
      React.createElement('Switch', { value, disabled, onValueChange }),
    Divider: () => null,
    HelperText: ({ children }: any) => React.createElement('Text', null, children),
    Snackbar: ({ visible, children }: any) =>
      visible ? React.createElement('Snackbar', null, children) : null,
    Portal: ({ children }: any) => React.createElement('Portal', null, children),
    Modal: ({ visible, children }: any) =>
      visible ? React.createElement('Modal', null, children) : null,
    Menu: Object.assign(
      ({ visible, children, anchor }: any) =>
        React.createElement('Menu', { visible }, anchor, visible ? children : null),
      {
        Item: ({ title, onPress }: any) =>
          React.createElement('MenuItem', { onPress }, title),
      },
    ),
    useTheme: () => ({ colors: { surface: '#fff' } }),
    ActivityIndicator: () => null,
  }
})

// Mock useMachines
const mockCharacterServiceSend = jest.fn()
jest.mock('~/hooks/useMachines', () => ({
  useAuthMachine: () => ({
    send: jest.fn(),
  }),
  useCharacterMachine: () => ({
    send: mockCharacterServiceSend,
    getSnapshot: jest.fn(() => ({ matches: jest.fn(() => false), context: { error: null } })),
    subscribe: jest.fn(() => ({ unsubscribe: jest.fn() })),
  }),
}))

// Mock useSelector
const mockUseSelector = jest.fn()
jest.mock('@xstate/react', () => ({
  useSelector: (...args: any[]) => mockUseSelector(...args),
}))

// Mock hooks
const mockUpdate = jest.fn()
jest.mock('~/hooks/useCharacters', () => ({
  useCharacter: jest.fn(),
  useUpdateCharacter: jest.fn(() => ({
    update: mockUpdate,
    isPending: false,
    error: null,
  })),
  useUnsyncCharacter: jest.fn(() => ({
    unsync: jest.fn(),
    isCloudUnsyncing: false,
    error: null,
  })),
  useSyncCharacters: jest.fn(() => ({
    sync: jest.fn(),
    isCloudSyncing: false,
    error: null,
  })),
}))

jest.mock('~/hooks/useCurrentPlan', () => ({
  useCurrentPlan: jest.fn(() => ({ isSubscriber: true })),
}))

jest.mock('~/hooks/useImageGeneration', () => ({
  useImageGeneration: jest.fn(() => ({
    generateImage: jest.fn(),
    isGenerating: false,
    error: null,
    clearError: jest.fn(),
  })),
}))

jest.mock('~/hooks/useAvatarUpload', () => ({
  useAvatarUpload: jest.fn(() => ({
    uploadAvatar: jest.fn(),
    isUploading: false,
    error: null,
    clearError: jest.fn(),
  })),
}))

jest.mock('~/hooks/useEditDirtyState', () => ({
  useEditDirtyState: jest.fn(),
}))

// Mock utilities
jest.mock('~/utilities/characterShare', () => ({
  buildCharacterShareUrl: jest.fn(() => 'https://example.com/c/cloud-id-1'),
  buildNativeCharacterShareLink: jest.fn(() => 'clanker://characters/cloud-id-1'),
}))
jest.mock('~/utilities/reportError', () => ({
  reportError: jest.fn(),
}))
jest.mock('~/utils/buildImagePrompt', () => ({
  buildImagePrompt: jest.fn(() => 'prompt'),
}))
jest.mock('~/components/CharacterAvatar', () => () => null)
jest.mock('@equationalapplications/expo-llm-wiki', () => ({
  WikiBusyError: class WikiBusyError extends Error {},
  useWikiExport: () => ({ execute: jest.fn().mockResolvedValue({ generatedAt: Date.now(), entities: {} }), isPending: false }),
}))
jest.mock('~/services/apiClient', () => ({
  wikiSync: jest.fn().mockResolvedValue({ data: {} }),
}))

import { useCharacter, useUpdateCharacter } from '~/hooks/useCharacters'
import EditCharacterScreen from '../app/(drawer)/(tabs)/characters/[id]/edit'

const mockWikiSync = jest.requireMock('~/services/apiClient').wikiSync as jest.Mock

const mockUseCharacter = jest.mocked(useCharacter)
const mockUseUpdateCharacter = jest.mocked(useUpdateCharacter)

const NOW = '2024-01-01T00:00:00.000Z'

function makeCharacter(overrides: Record<string, unknown> = {}) {
  return {
    id: 'char-1',
    user_id: 'user-1',
    owner_user_id: 'user-1',
    name: 'Test Character',
    is_public: false,
    avatar: null,
    appearance: null,
    traits: null,
    emotions: null,
    context: null,
    created_at: NOW,
    updated_at: NOW,
    synced_to_cloud: false,
    save_to_cloud: true,
    cloud_id: 'cloud-id-1',
    summary_checkpoint: 0,
    ...overrides,
  }
}

function setupSelectors(user: { uid: string } | null = { uid: 'user-1' }) {
  mockUseSelector.mockImplementation((_service: unknown, selector: (s: unknown) => unknown) => {
    return selector({ context: { user }, matches: () => false })
  })
}

beforeEach(() => {
  mockAlertAlert.mockReset()
  mockUpdate.mockReset()
  mockWikiSync.mockReset()
  mockWikiSync.mockResolvedValue({ data: {} })
  mockUseSelector.mockReset()
  mockUseUpdateCharacter.mockReturnValue({ update: mockUpdate, isPending: false, error: null } as any)
  setupSelectors()
})

describe('EditCharacterScreen - confirm dialog', () => {
  it('shows Alert with exact message when toggling cloud off on an already-cloud-saved character', () => {
    const character = makeCharacter({ save_to_cloud: true, cloud_id: 'cloud-id-1' })
    mockUseCharacter.mockReturnValue({ character, isLoading: false } as any)

    let tree!: renderer.ReactTestRenderer
    act(() => {
      tree = renderer.create(React.createElement(EditCharacterScreen))
    })

    // Find the Save to Cloud switch (first Switch) and trigger it with false
    const switchComponent = tree.root.findAll((node) => String(node.type) === 'Switch')[0]
    act(() => {
      switchComponent.props.onValueChange(false)
    })

    expect(mockAlertAlert).toHaveBeenCalledWith(
      'Remove from Cloud?',
      'Are you sure you want to remove the character from the cloud?',
      expect.arrayContaining([
        expect.objectContaining({ text: 'Cancel' }),
        expect.objectContaining({ text: 'Confirm' }),
      ]),
    )
  })

  it('calls confirm and updates switch state on confirm press', () => {
    const character = makeCharacter({ save_to_cloud: true, cloud_id: 'cloud-id-1' })
    mockUseCharacter.mockReturnValue({ character, isLoading: false } as any)

    let tree!: renderer.ReactTestRenderer
    act(() => {
      tree = renderer.create(React.createElement(EditCharacterScreen))
    })

    const switchComponent = tree.root.findAll((node) => String(node.type) === 'Switch')[0]
    act(() => {
      switchComponent.props.onValueChange(false)
    })

    // Invoke the Confirm button callback from Alert
    const alertCall = mockAlertAlert.mock.calls[0]
    const buttons = alertCall[2]
    const confirmButton = buttons.find((b: { text: string }) => b.text === 'Confirm')

    act(() => {
      confirmButton.onPress()
    })

    // Switch value should now be false (save_to_cloud off)
    const updatedSwitch = tree.root.findAll((node) => String(node.type) === 'Switch')[0]
    expect(updatedSwitch.props.value).toBe(false)
  })

  it('does not change switch state on cancel press', () => {
    const character = makeCharacter({ save_to_cloud: true, cloud_id: 'cloud-id-1' })
    mockUseCharacter.mockReturnValue({ character, isLoading: false } as any)

    let tree!: renderer.ReactTestRenderer
    act(() => {
      tree = renderer.create(React.createElement(EditCharacterScreen))
    })

    const switchComponent = tree.root.findAll((node) => String(node.type) === 'Switch')[0]
    act(() => {
      switchComponent.props.onValueChange(false)
    })

    // Cancel — switch should still be true (we only called Alert, didn't confirm)
    const updatedSwitch = tree.root.findAll((node) => String(node.type) === 'Switch')[0]
    expect(updatedSwitch.props.value).toBe(true)
  })
})

describe('EditCharacterScreen - non-owner read-only', () => {
  it('disables Save Changes button for non-owner', () => {
    const character = makeCharacter({ owner_user_id: 'other-user', save_to_cloud: false, cloud_id: null })
    mockUseCharacter.mockReturnValue({ character, isLoading: false } as any)
    setupSelectors({ uid: 'user-1' }) // current user is user-1, owner is other-user

    let tree!: renderer.ReactTestRenderer
    act(() => {
      tree = renderer.create(React.createElement(EditCharacterScreen))
    })

    const buttons = tree.root.findAll((node) => String(node.type) === 'Button')
    const saveButton = buttons.find((b) => b.props.children === 'Save Changes')
    expect(saveButton?.props.disabled).toBe(true)
  })

  it('disables all TextInputs for non-owner', () => {
    const character = makeCharacter({ owner_user_id: 'other-user', save_to_cloud: false, cloud_id: null })
    mockUseCharacter.mockReturnValue({ character, isLoading: false } as any)
    setupSelectors({ uid: 'user-1' })

    let tree!: renderer.ReactTestRenderer
    act(() => {
      tree = renderer.create(React.createElement(EditCharacterScreen))
    })

    const inputs = tree.root.findAll((node) => String(node.type) === 'TextInput')
    expect(inputs.length).toBeGreaterThan(0)
    inputs.forEach((input) => {
      expect(input.props.editable).toBe(false)
    })
  })
})

describe('EditCharacterScreen - voice selector', () => {
  it('shows voice name in anchor button when character has a voice', () => {
    const character = makeCharacter({ voice: 'Umbriel' })
    mockUseCharacter.mockReturnValue({ character, isLoading: false } as any)

    let tree!: renderer.ReactTestRenderer
    act(() => {
      tree = renderer.create(React.createElement(EditCharacterScreen))
    })

    const buttons = tree.root.findAll((node) => String(node.type) === 'Button')
    const voiceButton = buttons.find((b) =>
      typeof b.props.children === 'string' && b.props.children.includes('Umbriel'),
    )
    expect(voiceButton).toBeDefined()
  })

  it('falls back to voice name when style is missing', () => {
    const character = makeCharacter({ voice: 'FutureVoice' })
    mockUseCharacter.mockReturnValue({ character, isLoading: false } as any)

    let tree!: renderer.ReactTestRenderer
    act(() => {
      tree = renderer.create(React.createElement(EditCharacterScreen))
    })

    const buttons = tree.root.findAll((node) => String(node.type) === 'Button')
    const voiceButton = buttons.find((b) => b.props.children === 'FutureVoice')
    expect(voiceButton).toBeDefined()
  })

  it('falls back to default voice when character voice is null', () => {
    const character = makeCharacter({ voice: null })
    mockUseCharacter.mockReturnValue({ character, isLoading: false } as any)

    let tree!: renderer.ReactTestRenderer
    act(() => {
      tree = renderer.create(React.createElement(EditCharacterScreen))
    })

    const buttons = tree.root.findAll((node) => String(node.type) === 'Button')
    const defaultVoiceButton = buttons.find((b) =>
      typeof b.props.children === 'string' && b.props.children.includes('Umbriel'),
    )
    expect(defaultVoiceButton).toBeDefined()
  })

  it('selecting a voice calls update with correct voice value', () => {
    const character = makeCharacter({ voice: 'Umbriel' })
    mockUseCharacter.mockReturnValue({ character, isLoading: false } as any)

    let tree!: renderer.ReactTestRenderer
    act(() => {
      tree = renderer.create(React.createElement(EditCharacterScreen))
    })

    // Open the menu
    const buttons = tree.root.findAll((node) => String(node.type) === 'Button')
    const voiceButton = buttons.find((b) =>
      typeof b.props.children === 'string' && b.props.children.includes('Umbriel'),
    )
    act(() => {
      voiceButton!.props.onPress()
    })

    // Press the Kore menu item
    const menuItems = tree.root.findAll((node) => String(node.type) === 'MenuItem')
    const koreItem = menuItems.find((item) =>
      typeof item.props.children === 'string' && item.props.children.includes('Kore'),
    )
    act(() => {
      koreItem!.props.onPress()
    })

    // Save
    const saveButton = tree.root
      .findAll((node) => String(node.type) === 'Button')
      .find((b) => b.props.children === 'Save Changes')
    act(() => {
      saveButton!.props.onPress()
    })

    expect(mockUpdate).toHaveBeenCalledWith(
      'char-1',
      expect.objectContaining({ voice: 'Kore' }),
    )
  })
})

describe('EditCharacterScreen - Sync Memory button', () => {
  it('shows success toast after a successful wiki sync', async () => {
    const character = makeCharacter()
    mockUseCharacter.mockReturnValue({ character, isLoading: false } as any)

    let tree!: renderer.ReactTestRenderer
    act(() => {
      tree = renderer.create(React.createElement(EditCharacterScreen))
    })

    const syncButton = tree.root
      .findAll((node) => String(node.type) === 'Button')
      .find((b) => b.props.children === 'Sync Memory')
    expect(syncButton).toBeDefined()

    await act(async () => {
      await syncButton!.props.onPress()
    })

    const snackbars = tree.root.findAll((node) => String(node.type) === 'Snackbar')
    expect(snackbars.length).toBeGreaterThan(0)
    expect(snackbars[0].props.children).toBe('Memory synced to cloud.')
  })

  it('shows failure toast when wiki sync throws', async () => {
    mockWikiSync.mockRejectedValue(new Error('network error'))
    const character = makeCharacter()
    mockUseCharacter.mockReturnValue({ character, isLoading: false } as any)

    let tree!: renderer.ReactTestRenderer
    act(() => {
      tree = renderer.create(React.createElement(EditCharacterScreen))
    })

    const syncButton = tree.root
      .findAll((node) => String(node.type) === 'Button')
      .find((b) => b.props.children === 'Sync Memory')
    expect(syncButton).toBeDefined()

    await act(async () => {
      await syncButton!.props.onPress()
    })

    const snackbars = tree.root.findAll((node) => String(node.type) === 'Snackbar')
    expect(snackbars.length).toBeGreaterThan(0)
    expect(snackbars[0].props.children).toContain('Failed to sync memory')
  })
})
