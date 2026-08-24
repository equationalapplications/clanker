import React from 'react'
import { fireEvent, render, waitFor } from '@testing-library/react-native'
import ChatImageBubble from '../ChatImageBubble'
import * as MediaLibrary from 'expo-media-library'
import * as Sharing from 'expo-sharing'

jest.mock('~/hooks/useResolvedImage', () => ({
  useResolvedImage: (imageId: string | null, variant: 'thumb' | 'master') =>
    mockUseResolvedImage(imageId, variant),
}))

// Overridable per-test: the default resolves instantly for any non-null id.
const mockUseResolvedImage = jest.fn((imageId: string | null, variant: 'thumb' | 'master') => ({
  uri: imageId ? `file:///cache/${variant}.webp` : null,
  isResolved: !!imageId,
}))

jest.mock('expo-media-library', () => ({
  requestPermissionsAsync: jest.fn(),
  saveToLibraryAsync: jest.fn(),
}))

jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn(),
}))

const message = {
  _id: 'm1',
  text: '',
  createdAt: new Date(),
  user: { _id: 'char-1' },
  imageId: '11111111-2222-4333-8444-555555555555',
}

function openViewer() {
  const screen = render(<ChatImageBubble currentMessage={message} />)
  fireEvent.press(screen.getByLabelText('Photo in this message'))
  return screen
}

describe('ChatImageBubble viewer actions', () => {
  beforeEach(() => jest.clearAllMocks())

  it('saves the resolved master to the photo library after an add-only grant', async () => {
    ;(MediaLibrary.requestPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true })
    const screen = openViewer()

    fireEvent.press(screen.getByLabelText('Save to Photos'))

    await waitFor(() =>
      expect(MediaLibrary.saveToLibraryAsync).toHaveBeenCalledWith('file:///cache/master.webp'),
    )
    await waitFor(() => expect(screen.getByText('Saved to Photos')).toBeTruthy())
  })

  it('shows a notice on permission denial and saves nothing', async () => {
    ;(MediaLibrary.requestPermissionsAsync as jest.Mock).mockResolvedValue({ granted: false })
    const screen = openViewer()

    fireEvent.press(screen.getByLabelText('Save to Photos'))

    await waitFor(() => expect(screen.getByText('Photo library permission denied')).toBeTruthy())
    expect(MediaLibrary.saveToLibraryAsync).not.toHaveBeenCalled()
  })

  it('shows a notice when the save fails and leaves the viewer usable', async () => {
    ;(MediaLibrary.requestPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true })
    ;(MediaLibrary.saveToLibraryAsync as jest.Mock).mockRejectedValue(new Error('no space'))
    const screen = openViewer()

    fireEvent.press(screen.getByLabelText('Save to Photos'))

    await waitFor(() => expect(screen.getByText("Couldn't save to Photos")).toBeTruthy())
    // Both the backdrop and the Close button carry the "Close photo" label, so
    // getByLabelText would throw on the duplicate; assert presence instead.
    expect(screen.getAllByLabelText('Close photo').length).toBeGreaterThan(0)
  })

  it('shares the master URI through expo-sharing', async () => {
    const screen = openViewer()

    fireEvent.press(screen.getByLabelText('Share photo'))

    await waitFor(() =>
      expect(Sharing.shareAsync).toHaveBeenCalledWith('file:///cache/master.webp', {
        mimeType: 'image/webp',
        dialogTitle: 'Share image',
      }),
    )
  })

  it('shows a notice when sharing fails', async () => {
    ;(Sharing.shareAsync as jest.Mock).mockRejectedValue(new Error('no share sheet'))
    const screen = openViewer()

    fireEvent.press(screen.getByLabelText('Share photo'))

    await waitFor(() => expect(screen.getByText("Couldn't share this image")).toBeTruthy())
  })

  describe('while the master lookup is still in flight', () => {
    beforeEach(() => {
      mockUseResolvedImage.mockImplementation(
        (imageId: string | null, variant: 'thumb' | 'master') => ({
          // Thumb resolves instantly; the master never comes back.
          uri: variant === 'thumb' && imageId ? `file:///cache/thumb.webp` : null,
          isResolved: variant === 'thumb' && !!imageId,
        }),
      )
    })

    it('Save shows a loading notice and touches nothing', async () => {
      ;(MediaLibrary.requestPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true })
      const screen = openViewer()

      fireEvent.press(screen.getByLabelText('Save to Photos'))

      await waitFor(() =>
        expect(screen.getByText('Loading photo — try again in a moment')).toBeTruthy(),
      )
      expect(MediaLibrary.requestPermissionsAsync).not.toHaveBeenCalled()
      expect(MediaLibrary.saveToLibraryAsync).not.toHaveBeenCalled()
    })

    it('Share shows a loading notice and opens no sheet', async () => {
      const screen = openViewer()

      fireEvent.press(screen.getByLabelText('Share photo'))

      await waitFor(() =>
        expect(screen.getByText('Loading photo — try again in a moment')).toBeTruthy(),
      )
      expect(Sharing.shareAsync).not.toHaveBeenCalled()
    })
  })

  describe('after the master lookup completes without a URI', () => {
    beforeEach(() => {
      mockUseResolvedImage.mockImplementation(
        (imageId: string | null, variant: 'thumb' | 'master') => ({
          uri: variant === 'thumb' && imageId ? `file:///cache/thumb.webp` : null,
          isResolved: variant === 'thumb' ? !!imageId : true,
        }),
      )
    })

    it('Save reports the photo as unavailable', async () => {
      ;(MediaLibrary.requestPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true })
      const screen = openViewer()

      fireEvent.press(screen.getByLabelText('Save to Photos'))

      await waitFor(() => expect(screen.getByText('Photo unavailable')).toBeTruthy())
      expect(MediaLibrary.saveToLibraryAsync).not.toHaveBeenCalled()
    })

    it('Share reports the photo as unavailable', async () => {
      const screen = openViewer()

      fireEvent.press(screen.getByLabelText('Share photo'))

      await waitFor(() => expect(screen.getByText('Photo unavailable')).toBeTruthy())
      expect(Sharing.shareAsync).not.toHaveBeenCalled()
    })
  })
})
