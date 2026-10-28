import React from 'react'
import { PaperProvider } from 'react-native-paper'
import { render } from '@testing-library/react-native'
import { MessageBubble } from '../MessageBubble'
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

const renderWithProvider = async (ui: React.ReactElement) =>
  await render(<PaperProvider>{ui}</PaperProvider>)

describe('MessageBubble', () => {
  it('renders the text', async () => {
    const { getByText } = await renderWithProvider(<MessageBubble message={baseMessage} isOwn={true} />)
    expect(getByText('hello')).toBeTruthy()
  })

  it('renders ChatImageBubble when imageId is set, with no `image` field required', async () => {
    const { getByLabelText } = await renderWithProvider(
      <MessageBubble message={{ ...baseMessage, imageId: 'img-1' }} isOwn={true} />,
    )
    // RNTL v14 removed the *ByType queries; the mocked useResolvedImage makes
    // ChatImageBubble render its placeholder, which carries this label.
    expect(getByLabelText('Photo unavailable')).toBeTruthy()
  })

  it('does not render ChatImageBubble when imageId is absent', async () => {
    const { queryByLabelText } = await renderWithProvider(
      <MessageBubble message={baseMessage} isOwn={true} />,
    )
    expect(queryByLabelText('Photo unavailable')).toBeNull()
  })

  it('renders the grounding footer when groundingMetadata is set', async () => {
    const { getByText } = await renderWithProvider(
      <MessageBubble
        message={{
          ...baseMessage,
          groundingMetadata: {
            groundingChunks: [{ web: { uri: 'https://example.com', title: 'Example' } }],
          },
        }}
        isOwn={false}
      />,
    )
    expect(getByText('Example')).toBeTruthy()
  })
})
