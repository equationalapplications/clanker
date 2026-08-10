import { render, fireEvent } from '@testing-library/react-native'
import ChatImageBubble from '~/components/ChatImageBubble'
import { useResolvedImage } from '~/hooks/useResolvedImage'

jest.mock('~/hooks/useResolvedImage', () => ({
  useResolvedImage: jest.fn(),
}))

it('renders the thumb variant, not the master', () => {
  ;(useResolvedImage as jest.Mock).mockReturnValue('file:///thumb.webp')

  const { getByLabelText } = render(
    <ChatImageBubble currentMessage={{ _id: 'm1', imageId: 'img-1' } as never} />,
  )

  expect(useResolvedImage).toHaveBeenCalledWith('img-1', 'thumb')
  expect(getByLabelText('Photo in this message')).toBeTruthy()
})

it('opens the master in a viewer on tap', () => {
  ;(useResolvedImage as jest.Mock).mockReturnValue('file:///thumb.webp')

  const { getByLabelText, queryByLabelText } = render(
    <ChatImageBubble currentMessage={{ _id: 'm1', imageId: 'img-1' } as never} />,
  )
  expect(queryByLabelText('Full size photo')).toBeNull()

  fireEvent.press(getByLabelText('Photo in this message'))

  expect(getByLabelText('Full size photo')).toBeTruthy()
  expect(useResolvedImage).toHaveBeenCalledWith('img-1', 'master')
})

it('degrades to nothing when the image no longer resolves', () => {
  // The photo may have been deleted from the Avatar Picker, evicted by the FIFO
  // cap, or not yet synced to this device. The message keeps its text either way.
  ;(useResolvedImage as jest.Mock).mockReturnValue(null)

  const { queryByLabelText, getByLabelText } = render(
    <ChatImageBubble currentMessage={{ _id: 'm1', imageId: 'img-1' } as never} />,
  )

  expect(queryByLabelText('Photo in this message')).toBeNull()
  expect(getByLabelText('Photo unavailable')).toBeTruthy()
})

it('renders nothing for a message with no image', () => {
  const { toJSON } = render(<ChatImageBubble currentMessage={{ _id: 'm1' } as never} />)
  expect(toJSON()).toBeNull()
})
