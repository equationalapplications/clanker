import React from 'react'
import { act, create } from 'react-test-renderer'

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
  })

  afterEach(() => {
    jest.restoreAllMocks()
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

  it('does NOT render plus button for premium users without characterId', () => {
    let tree!: ReturnType<typeof create>
    act(() => {
      tree = create(<ChatComposer text="" onSend={jest.fn()} hasUnlimited={true} />)
    })
    expect(tree.root.findAllByProps({ testID: 'plus-button' })).toHaveLength(0)
  })

  it('pressing plus button directly dispatches document ingest', () => {
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
