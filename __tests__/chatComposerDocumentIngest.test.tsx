import React from 'react'
import { act, create } from 'react-test-renderer'
import { Alert } from 'react-native'

const mockDispatchDocumentIngest = jest.fn()
const mockGetDocumentIngestMachineActor = jest.fn()

jest.mock('~/machines/documentIngestMachine', () => ({
  dispatchDocumentIngest: (...args: any[]) => mockDispatchDocumentIngest(...args),
  getDocumentIngestMachineActor: (...args: any[]) => mockGetDocumentIngestMachineActor(...args),
}))

jest.mock('~/components/composer/IngestProgressBar', () => {
  const React = require('react')
  return ({ progress }: { progress: number }) =>
    progress > 0 ? React.createElement('View', { testID: 'progress-bar' }) : null
})

jest.mock('react-native-paper', () => {
  const React = require('react')
  return {
    IconButton: ({ onPress, accessibilityLabel }: any) =>
      React.createElement('TouchableOpacity', { testID: 'plus-button', onPress, accessibilityLabel }),
    Snackbar: ({ visible, children }: any) =>
      visible ? React.createElement('Text', { testID: 'snackbar' }, children) : null,
    Portal: ({ children }: any) => children,
  }
})

jest.mock('react-native-gifted-chat', () => {
  const React = require('react')
  return {
    Composer: (props: any) =>
      React.createElement('TextInput', { testID: 'composer-input', ...props.textInputProps }),
  }
})

import ChatComposer from '~/components/ChatComposer'

describe('ChatComposer with document ingest', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.spyOn(Alert, 'alert')
  })

  it('does NOT render plus button for non-premium users', () => {
    let tree!: ReturnType<typeof create>
    act(() => {
      tree = create(
        <ChatComposer text="" onSend={jest.fn()} characterId="char-1" userId="user-1" hasUnlimited={false} />,
      )
    })
    expect(tree.root.findAllByProps({ testID: 'plus-button' })).toHaveLength(0)
  })

  it('renders plus button for premium users with characterId and userId', () => {
    let tree!: ReturnType<typeof create>
    act(() => {
      tree = create(
        <ChatComposer text="" onSend={jest.fn()} characterId="char-1" userId="user-1" hasUnlimited={true} />,
      )
    })
    expect(tree.root.findAllByProps({ testID: 'plus-button' })).toHaveLength(1)
  })

  it('renders plus button for premium users regardless of cloud sync status', () => {
    let tree!: ReturnType<typeof create>
    act(() => {
      tree = create(
        <ChatComposer text="" onSend={jest.fn()} characterId="char-1" userId="user-1" hasUnlimited={true} />,
      )
    })
    expect(tree.root.findAllByProps({ testID: 'plus-button' })).toHaveLength(1)
  })

  it('does NOT render plus button for premium users without characterId', () => {
    let tree!: ReturnType<typeof create>
    act(() => {
      tree = create(<ChatComposer text="" onSend={jest.fn()} hasUnlimited={true} />)
    })
    expect(tree.root.findAllByProps({ testID: 'plus-button' })).toHaveLength(0)
  })

  it('pressing plus button shows Alert with "Add document to memory" option', () => {
    let tree!: ReturnType<typeof create>
    act(() => {
      tree = create(
        <ChatComposer text="" onSend={jest.fn()} characterId="char-1" userId="user-1" hasUnlimited={true} />,
      )
    })
    const button = tree.root.findByProps({ testID: 'plus-button' })
    act(() => { button.props.onPress() })
    expect(Alert.alert).toHaveBeenCalledWith(
      'Add to Memory',
      expect.any(String),
      expect.arrayContaining([
        expect.objectContaining({ text: 'Add document to memory' }),
        expect.objectContaining({ text: 'Cancel' }),
      ]),
    )
  })

  it('dispatches ingest when "Add document to memory" is pressed', () => {
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _msg, buttons) => {
      const addBtn = (buttons as any[])?.find((b) => b.text === 'Add document to memory')
      addBtn?.onPress?.()
    })
    let tree!: ReturnType<typeof create>
    act(() => {
      tree = create(
        <ChatComposer text="" onSend={jest.fn()} characterId="char-1" userId="user-1" hasUnlimited={true} />,
      )
    })
    const button = tree.root.findByProps({ testID: 'plus-button' })
    act(() => { button.props.onPress() })
    expect(mockDispatchDocumentIngest).toHaveBeenCalledWith('char-1', 'user-1')
  })
})
