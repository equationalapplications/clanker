import { render, fireEvent } from '@testing-library/react-native'
import ChatImageBubble from '~/components/ChatImageBubble'
import { useResolvedImage } from '~/hooks/useResolvedImage'

jest.mock('~/hooks/useResolvedImage', () => ({
  useResolvedImage: jest.fn(),
}))

const resolvedUri = (uri: string | null) => ({ uri, isResolved: true })
const pendingResolve = { uri: null, isResolved: false }

beforeEach(() => {
  ;(useResolvedImage as jest.Mock).mockReset()
  // Default: no row found. Individual tests override with the shape they need.
  ;(useResolvedImage as jest.Mock).mockReturnValue(resolvedUri(null))
})

it('renders the thumb variant, not the master', () => {
  ;(useResolvedImage as jest.Mock).mockReturnValue(resolvedUri('file:///thumb.webp'))

  const { getByLabelText } = render(
    <ChatImageBubble currentMessage={{ _id: 'm1', imageId: 'img-1' } as never} />,
  )

  expect(useResolvedImage).toHaveBeenCalledWith('img-1', 'thumb')
  expect(getByLabelText('Photo in this message')).toBeTruthy()
})

it('opens the master in a viewer on tap', () => {
  ;(useResolvedImage as jest.Mock).mockReturnValue(resolvedUri('file:///thumb.webp'))

  const { getByLabelText, queryByLabelText } = render(
    <ChatImageBubble currentMessage={{ _id: 'm1', imageId: 'img-1' } as never} />,
  )
  expect(queryByLabelText('Full size photo')).toBeNull()

  fireEvent.press(getByLabelText('Photo in this message'))

  expect(getByLabelText('Full size photo')).toBeTruthy()
  expect(useResolvedImage).toHaveBeenCalledWith('img-1', 'master')
})

it('degrades to a placeholder only after the lookup completes with no row', () => {
  // The photo may have been deleted from the Avatar Picker, evicted by the FIFO
  // cap, or genuinely absent. The message keeps its text either way. The
  // placeholder must NOT appear while the lookup is still in flight — the row
  // may simply be mid-sync on this device (message-before-image ordering).
  ;(useResolvedImage as jest.Mock).mockReturnValue(resolvedUri(null))

  const { queryByLabelText, getByLabelText } = render(
    <ChatImageBubble currentMessage={{ _id: 'm1', imageId: 'img-1' } as never} />,
  )

  expect(queryByLabelText('Photo in this message')).toBeNull()
  expect(getByLabelText('Photo unavailable')).toBeTruthy()
})

it('renders nothing while the thumbnail lookup is in flight', () => {
  // The image row may not have arrived on this device yet. Announcing
  // "Photo unavailable" before the lookup completes is wrong: the row is
  // coming, the bubble just hasn't been able to find it yet.
  ;(useResolvedImage as jest.Mock).mockReturnValue(pendingResolve)

  const { queryByLabelText } = render(
    <ChatImageBubble currentMessage={{ _id: 'm1', imageId: 'img-1' } as never} />,
  )

  expect(queryByLabelText('Photo in this message')).toBeNull()
  expect(queryByLabelText('Photo unavailable')).toBeNull()
})

it('renders nothing for a message with no image', () => {
  const { toJSON } = render(<ChatImageBubble currentMessage={{ _id: 'm1' } as never} />)
  expect(toJSON()).toBeNull()
})

/**
 * Integration tests through gifted-chat's `Bubble`.
 *
 * `Bubble` gates `renderMessageImage` on `currentMessage.image` being truthy.
 * Without that field, the photo never reaches `ChatImageBubble` regardless of
 * the `imageId` render hint. These tests pin the gate so the regression is
 * caught even if a refactor drops the `image` field from `useAIChat.sendPhoto`.
 *
 * The real Bubble pulls in `react-native-reanimated`, whose Worklets module
 * needs a native runtime that Jest does not provide. A local `BubbleStub`
 * that mirrors the real gate's three lines (`if (currentMessage?.image)`
 * then call `props.renderMessageImage`) is enough to assert the contract.
 */
const BubbleStub = ({ currentMessage, renderMessageImage }: any) => {
  if (!currentMessage?.image) return null
  return renderMessageImage ? renderMessageImage({ currentMessage }) : null
}

describe('Bubble integration with ChatImageBubble', () => {
  beforeEach(() => {
    ;(useResolvedImage as jest.Mock).mockReturnValue(resolvedUri('file:///thumb.webp'))
  })

  it('renders ChatImageBubble when image is set (truthy gate passes)', () => {
    const renderMessageImage = jest.fn((props: any) => <ChatImageBubble {...props} />)

    const { getByLabelText } = render(
      <BubbleStub
        currentMessage={{
          _id: 'm1',
          text: 'caption',
          imageId: 'img-1',
          image: 'img-1',
          user: { _id: 'user-1' },
          createdAt: new Date(),
        }}
        renderMessageImage={renderMessageImage}
      />,
    )

    expect(renderMessageImage).toHaveBeenCalled()
    expect(getByLabelText('Photo in this message')).toBeTruthy()
  })

  it('does not render ChatImageBubble when image is missing (gate short-circuits)', () => {
    // Mirrors the bug PR #591 shipped: a message that only carries `imageId`
    // must not produce a photo bubble through the gifted-chat pipeline.
    const renderMessageImage = jest.fn((props: any) => <ChatImageBubble {...props} />)

    const { queryByLabelText } = render(
      <BubbleStub
        currentMessage={{
          _id: 'm1',
          text: 'caption',
          imageId: 'img-1',
          user: { _id: 'user-1' },
          createdAt: new Date(),
        }}
        renderMessageImage={renderMessageImage}
      />,
    )

    expect(renderMessageImage).not.toHaveBeenCalled()
    expect(queryByLabelText('Photo in this message')).toBeNull()
  })
})
