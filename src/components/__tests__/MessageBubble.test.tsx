import React from 'react'
import { PaperProvider } from 'react-native-paper'
import { render } from '@testing-library/react-native'
import { MessageBubble } from '../MessageBubble'
import ChatImageBubble from '~/components/ChatImageBubble'
import type { Message } from '~/types/chat'

// Mock useResolvedImage to avoid pulling Firebase through ChatImageBubble.
// Same pattern used by __tests__/chatImageBubble.test.tsx.
jest.mock('~/hooks/useResolvedImage', () => ({
  useResolvedImage: jest.fn().mockReturnValue({ uri: null, isResolved: true }),
}))

const baseUser = { _id: 'user', name: 'You' }
const baseMessage: Message = {
  _id: 'm1',
  text: 'hello',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  user: baseUser,
}

const renderWithProvider = (ui: React.ReactElement) =>
  render(<PaperProvider>{ui}</PaperProvider>)

describe('MessageBubble', () => {
  it('renders the text', () => {
    const { getByText } = renderWithProvider(
      <MessageBubble message={baseMessage} isOwn={true} />,
    )
    expect(getByText('hello')).toBeTruthy()
  })

  it('renders ChatImageBubble when imageId is set, with no `image` field required', () => {
    const { UNSAFE_getByType } = renderWithProvider(
      <MessageBubble
        message={{ ...baseMessage, imageId: 'img-1' }}
        isOwn={true}
      />,
    )
    expect(UNSAFE_getByType(ChatImageBubble)).toBeTruthy()
  })

  it('does not render ChatImageBubble when imageId is absent', () => {
    const { UNSAFE_queryByType } = renderWithProvider(
      <MessageBubble message={baseMessage} isOwn={true} />,
    )
    expect(UNSAFE_queryByType(ChatImageBubble)).toBeNull()
  })

  it('renders the grounding footer when groundingMetadata is set', () => {
    const { getByText } = renderWithProvider(
      <MessageBubble
        message={{
          ...baseMessage,
          groundingMetadata: {
            groundingChunks: [
              { web: { uri: 'https://example.com', title: 'Example' } },
            ],
          },
        }}
        isOwn={false}
      />,
    )
    expect(getByText('Example')).toBeTruthy()
  })
})