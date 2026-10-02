import React from 'react'
import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import ChatImageBubble from '../ChatImageBubble'
// The photo-save seam imports the package's `legacy` subpath (the main entry's
// saveToLibraryAsync is a throw-on-call deprecation shim), so the mock and the
// assertion handle must target that specifier.
import * as MediaLibrary from 'expo-media-library/legacy'
import * as Sharing from 'expo-sharing'
import { File } from 'expo-file-system'

jest.mock('~/hooks/useResolvedImage', () => ({
  useResolvedImage: (imageId: string | null, variant: 'thumb' | 'master') =>
    mockUseResolvedImage(imageId, variant),
}))

// Overridable per-test: the default resolves instantly for any non-null id.
const mockUseResolvedImage = jest.fn((imageId: string | null, variant: 'thumb' | 'master') => ({
  uri: imageId ? `file:///cache/${variant}.webp` : null,
  isResolved: !!imageId,
}))

jest.mock('expo-media-library/legacy', () => ({
  requestPermissionsAsync: jest.fn(),
  saveToLibraryAsync: jest.fn(),
}))

jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn(),
}))

// The image-share seam stages remote masters through expo-file-system.
jest.mock('expo-file-system', () => {
  class FakeFile {
    uri: string
    readonly delete = jest.fn()
    static readonly instances: FakeFile[] = []
    constructor(_dir: unknown, name: string) {
      // Real File instances always carry the file:// scheme — the fake must
      // too, since the Android share bridge rejects anything else.
      this.uri = `file:///cache/photo-share/${name}`
      void _dir
      FakeFile.instances.push(this)
    }
  }
  return {
    Paths: { cache: '/cache' },
    Directory: class {
      exists = false
      create(): void {}
      list(): unknown[] {
        return FakeFile.instances
      }
    },
    File: Object.assign(FakeFile, { downloadFileAsync: jest.fn(async () => undefined) }),
  }
})

const fakeShareFs = File as unknown as typeof File & {
  downloadFileAsync: jest.Mock
  instances: { uri: string; delete: jest.Mock }[]
}

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
  beforeEach(() => {
    jest.clearAllMocks()
    // clearAllMocks resets call history but NOT implementations — the
    // no-share-sheet test below overrides this default with false, which
    // would otherwise poison every later test in this file. Same for the
    // staging-failure test's mockRejectedValue on the download.
    ;(Sharing.isAvailableAsync as jest.Mock).mockResolvedValue(true)
    fakeShareFs.downloadFileAsync.mockReset().mockResolvedValue(undefined)
    fakeShareFs.instances.length = 0
  })

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

  it('ignores a second Share tap while one share is in flight', async () => {
    // The Android bridge throws SharingInProgressException for concurrent
    // share calls, which would surface as "Couldn't share this image" right
    // after the first share succeeded.
    let resolveShare!: () => void
    ;(Sharing.shareAsync as jest.Mock).mockReturnValue(
      new Promise<void>((resolve) => {
        resolveShare = resolve
      }),
    )
    const screen = openViewer()

    fireEvent.press(screen.getByLabelText('Share photo'))
    // The first press is mid-flight once the sheet is up; the second must be
    // a no-op rather than a second bridge call.
    await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalledTimes(1))
    fireEvent.press(screen.getByLabelText('Share photo'))

    await act(async () => {
      resolveShare()
    })
    expect(Sharing.shareAsync).toHaveBeenCalledTimes(1)
  })

  it('shows a notice when sharing fails', async () => {
    ;(Sharing.shareAsync as jest.Mock).mockRejectedValue(new Error('no share sheet'))
    const screen = openViewer()

    fireEvent.press(screen.getByLabelText('Share photo'))

    await waitFor(() => expect(screen.getByText("Couldn't share this image")).toBeTruthy())
  })

  it('shows a notice when the platform has no share sheet', async () => {
    ;(Sharing.isAvailableAsync as jest.Mock).mockResolvedValue(false)
    const screen = openViewer()

    fireEvent.press(screen.getByLabelText('Share photo'))

    await waitFor(() => expect(screen.getByText('Sharing is not available here')).toBeTruthy())
    expect(Sharing.shareAsync).not.toHaveBeenCalled()
  })

  describe('when the resolved master is a remote URL (cloud rows)', () => {
    beforeEach(() => {
      mockUseResolvedImage.mockImplementation(
        (imageId: string | null, variant: 'thumb' | 'master') => ({
          uri: imageId
            ? `https://firebasestorage.googleapis.com/v0/b/bucket/o/${variant}.webp?alt=media&token=t`
            : null,
          isResolved: !!imageId,
        }),
      )
    })

    it('Share stages the remote master locally and never shares the raw URL', async () => {
      const screen = openViewer()

      fireEvent.press(screen.getByLabelText('Share photo'))

      await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalled())
      const sharedUri = (Sharing.shareAsync as jest.Mock).mock.calls[0][0] as string
      // The Android bridge rejects anything but file://, so the raw URL would
      // fail — the original bug. Assert the required scheme, not just the
      // absence of http(s).
      expect(sharedUri).toMatch(/^file:\/\//)
      expect(sharedUri).toMatch(/share_.*\.webp$/)
      expect(fakeShareFs.downloadFileAsync).toHaveBeenCalledWith(
        expect.stringMatching(/^https:/),
        // A File instance, not a plain {uri} object — match on the uri only.
        expect.objectContaining({ uri: sharedUri }),
      )
      // The staged file must survive the share: the Android bridge resolves
      // the promise before the target app has necessarily read the URI.
      const staged = fakeShareFs.instances.find((f) => f.uri === sharedUri)
      expect(staged).toBeDefined()
      expect(staged!.delete).not.toHaveBeenCalled()
    })

    it('Share shows the failure notice when staging the download fails', async () => {
      fakeShareFs.downloadFileAsync.mockRejectedValue(new Error('offline'))
      const screen = openViewer()

      fireEvent.press(screen.getByLabelText('Share photo'))

      await waitFor(() => expect(screen.getByText("Couldn't share this image")).toBeTruthy())
      expect(Sharing.shareAsync).not.toHaveBeenCalled()
    })
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
