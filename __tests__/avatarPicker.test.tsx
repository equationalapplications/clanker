import React from 'react'
import { act, create } from 'react-test-renderer'
import { Alert } from 'react-native'

// Auto-confirm the destructive delete flow: real Alert.alert invokes the
// tapped button's onPress asynchronously, but tests drive onLongPress
// directly and need a deterministic outcome.
jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
  const destructive = buttons?.find((button) => button.style === 'destructive')
  destructive?.onPress?.()
})

const mockGetImages = jest.fn()
const mockSetActive = jest.fn()
const mockDeleteImage = jest.fn()
const mockUploadAvatar = jest.fn()
const mockGenerateImage = jest.fn()

jest.mock('react-native-paper', () => {
  const React = require('react')
  const RN = require('react-native')
  return {
    Button: ({ children, onPress, testID, loading, disabled, icon, mode, style }: any) =>
      React.createElement(RN.TouchableOpacity, { onPress, testID, disabled, style }, [
        React.createElement(RN.Text, { key: 'label' }, children),
      ]),
    Dialog: Object.assign(
      ({ children, visible, onDismiss, style }: any) =>
        visible ? React.createElement(RN.View, { style }, children) : null,
      {
        Title: ({ children }: any) => React.createElement(RN.Text, null, children),
        Content: ({ children }: any) => React.createElement(RN.View, null, children),
        Actions: ({ children }: any) => React.createElement(RN.View, null, children),
      },
    ),
    HelperText: ({ children, type, visible }: any) =>
      visible ? React.createElement(RN.Text, null, children) : null,
    Icon: ({ source, size }: any) => React.createElement(RN.View, { testID: `icon-${source}` }),
    Portal: ({ children }: any) => React.createElement(RN.View, null, children),
    Text: ({ children, style, testID }: any) =>
      React.createElement(RN.Text, { style, testID }, children),
    useTheme: () => ({ colors: { onSurfaceVariant: '#666' } }),
  }
})

jest.mock('~/database/characterImageDatabase', () => ({
  getCharacterImages: (...a: unknown[]) => mockGetImages(...a),
  setActiveImageId: (...a: unknown[]) => mockSetActive(...a),
}))
jest.mock('~/services/characterImageService', () => ({
  deleteCharacterImage: (...a: unknown[]) => mockDeleteImage(...a),
}))
jest.mock('~/services/characterImageSyncService', () => ({
  pushActiveImageId: jest.fn(),
}))
jest.mock('~/services/localImageStore', () => ({
  resolveImageUri: jest.fn(async (row: any) => `resolved:${row.id}`),
}))
jest.mock('~/hooks/useAvatarUpload', () => ({
  useAvatarUpload: () => ({ uploadAvatar: mockUploadAvatar, isUploading: false, error: null, clearError: jest.fn() }),
}))
jest.mock('~/hooks/useImageGeneration', () => ({
  useImageGeneration: () => ({ generateImage: mockGenerateImage, isGenerating: false, error: null, clearError: jest.fn() }),
}))
jest.mock('~/hooks/useMachines', () => ({ useCharacterMachine: () => ({ send: jest.fn() }) }))
jest.mock('~/config/firebaseConfig', () => ({
  getCurrentUser: jest.fn(() => ({ uid: 'user-1' })),
}))

import { AvatarPicker } from '~/components/AvatarPicker'

const rows = [
  { id: 'img-2', character_id: 'char_a', storage_kind: 'inline', master_ref: 'M2', thumb_ref: 'T2', mime_type: 'image/webp', created_at: 2, deleted_at: null },
  { id: 'img-1', character_id: 'char_a', storage_kind: 'inline', master_ref: 'M1', thumb_ref: 'T1', mime_type: 'image/webp', created_at: 1, deleted_at: null },
]

async function renderPicker(props: Partial<React.ComponentProps<typeof AvatarPicker>> = {}) {
  let tree: any
  await act(async () => {
    tree = create(
      <AvatarPicker
        visible
        characterId="char_a"
        activeImageId="img-2"
        imagePrompt="a knight"
        onDismiss={jest.fn()}
        onActiveImageChange={jest.fn()}
        {...props}
      />,
    )
  })
  await act(async () => { await Promise.resolve() })
  return tree
}

beforeEach(() => {
  jest.clearAllMocks()
  mockGetImages.mockResolvedValue(rows)
})

describe('AvatarPicker', () => {
  it('lists every live image newest first', async () => {
    const tree = await renderPicker()
    const items = tree.root.findAllByProps({ testID: 'avatar-picker-item' }, { deep: false })
    expect(items.map((i: any) => i.props.accessibilityLabel)).toEqual([
      'Avatar 1 of 2, selected',
      'Avatar 2 of 2',
    ])
  })

  it('activates the tapped image and reports it upward', async () => {
    const onActiveImageChange = jest.fn()
    const tree = await renderPicker({ onActiveImageChange })
    const items = tree.root.findAllByProps({ testID: 'avatar-picker-item' }, { deep: false })
    await act(async () => { await items[1].props.onPress() })
    expect(mockSetActive).toHaveBeenCalledWith('char_a', 'img-1')
    expect(onActiveImageChange).toHaveBeenCalledWith('img-1')
  })

  it('deletes on long press and refreshes the list', async () => {
    const tree = await renderPicker()
    const items = tree.root.findAllByProps({ testID: 'avatar-picker-item' }, { deep: false })
    mockGetImages.mockResolvedValue([rows[0]])
    await act(async () => { await items[1].props.onLongPress() })
    expect(mockDeleteImage).toHaveBeenCalledWith('img-1', expect.anything())
    expect(mockGetImages).toHaveBeenCalledTimes(2)
  })

  it('shows an empty state when the character has no images', async () => {
    mockGetImages.mockResolvedValue([])
    const tree = await renderPicker()
    expect(tree.root.findAllByProps({ testID: 'avatar-picker-empty' }).length).toBeGreaterThan(0)
  })

  it('generates from the header using the supplied prompt', async () => {
    const tree = await renderPicker()
    const button = tree.root.findByProps({ testID: 'avatar-picker-generate' })
    await act(async () => { await button.props.onPress() })
    expect(mockGenerateImage).toHaveBeenCalledWith('a knight')
  })

  it('uploads from the header', async () => {
    const tree = await renderPicker()
    const button = tree.root.findByProps({ testID: 'avatar-picker-upload' })
    await act(async () => { await button.props.onPress() })
    expect(mockUploadAvatar).toHaveBeenCalled()
  })

  it('marks images that failed to back up', async () => {
    mockGetImages.mockResolvedValue([
      { ...rows[0], sync_state: 'failed' },
      { ...rows[1], sync_state: 'synced' },
    ])
    const tree = await renderPicker()
    const items = tree.root.findAllByProps({ testID: 'avatar-picker-item' }, { deep: false })
    expect(items[0].props.accessibilityLabel).toContain('not backed up')
    expect(items[1].props.accessibilityLabel).not.toContain('not backed up')
  })

  it('does not mark a privacy-mode image as un-backed-up', async () => {
    mockGetImages.mockResolvedValue([{ ...rows[0], sync_state: 'local' }])
    const tree = await renderPicker()
    const items = tree.root.findAllByProps({ testID: 'avatar-picker-item' }, { deep: false })
    expect(items[0].props.accessibilityLabel).not.toContain('not backed up')
  })
})