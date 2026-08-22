import React from 'react'
import { render } from '@testing-library/react-native'
import { MessageList } from '../MessageList'
import type { Message } from '~/types/chat'

// Mock useResolvedImage to avoid pulling Firebase through ChatImageBubble → MessageBubble → MessageRow.
// Same pattern used by MessageBubble.test.tsx.
jest.mock('~/hooks/useResolvedImage', () => ({
  useResolvedImage: jest.fn().mockReturnValue({ uri: null, isResolved: true }),
}))

const baseMessage: Message = {
  _id: 'streaming-1',
  text: '',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  user: { _id: 'character-1', name: 'Bot' },
}

describe('MessageList streaming-key invariant', () => {
  it('preserves the message _id across streaming updates', () => {
    // A React-component avatar mock (not a render prop) makes remounts
    // observable: if the keyed row were torn down and rebuilt on each
    // streaming update, the avatar component would unmount and remount.
    // useEffect with empty deps fires exactly once on mount and again on
    // remount — but not on plain re-renders — so this distinguishes the
    // two. Streaming should update the same row in place, so the effect
    // fires only once across both renders.
    let avatarMountCount = 0
    const CountingAvatar: React.FC = () => {
      React.useEffect(() => {
        avatarMountCount += 1
      }, [])
      return null
    }
    const renderAvatar = (_message: Message) => <CountingAvatar />

    const first = render(
      <MessageList messages={[baseMessage]} currentUserId="user" renderAvatar={renderAvatar} />,
    )
    expect(avatarMountCount).toBe(1)

    // Force a streaming update — same _id, new text
    const updated: Message = { ...baseMessage, text: 'hello world' }
    first.rerender(
      <MessageList messages={[updated]} currentUserId="user" renderAvatar={renderAvatar} />,
    )

    expect(avatarMountCount).toBe(1)
    expect(first.getByText('hello world')).toBeTruthy()
  })

  it('renders one row per message when _ids are unique', () => {
    // Two messages with distinct _ids must render two rows. A regression
    // that drops keyExtractor or flattens the data would collapse them.
    const renderAvatar = () => null
    const a: Message = { ...baseMessage, _id: 'msg-a', text: 'message a' }
    const b: Message = { ...baseMessage, _id: 'msg-b', text: 'message b' }
    const { getByText } = render(
      <MessageList messages={[a, b]} currentUserId="user" renderAvatar={renderAvatar} />,
    )
    expect(getByText('message a')).toBeTruthy()
    expect(getByText('message b')).toBeTruthy()
  })

  it('does not remount a row when a persisted row replaces the streamed row under the same _id', () => {
    // Fix A makes stream→persist a same-key, fresh-identity swap: the refetch
    // delivers a new row object whose _id equals the streamed one. This pins
    // that MessageList reconciles in place across that swap. Expected green
    // before and after the useAIChat change — it guards the list layer the id
    // unification now exercises.
    let avatarMountCount = 0
    const CountingAvatar: React.FC = () => {
      React.useEffect(() => {
        avatarMountCount += 1
      }, [])
      return null
    }
    const renderAvatar = (_message: Message) => <CountingAvatar />

    const streamed: Message = { ...baseMessage, _id: 'ai_42', text: '' }
    const view = render(
      <MessageList messages={[streamed]} currentUserId="user" renderAvatar={renderAvatar} />,
    )
    expect(avatarMountCount).toBe(1)

    // Refetch delivers the persisted row: fresh object identity, same _id.
    const persisted: Message = { ...baseMessage, _id: 'ai_42', text: 'hello world' }
    view.rerender(
      <MessageList messages={[persisted]} currentUserId="user" renderAvatar={renderAvatar} />,
    )

    expect(avatarMountCount).toBe(1)
    expect(view.getByText('hello world')).toBeTruthy()
  })
})
