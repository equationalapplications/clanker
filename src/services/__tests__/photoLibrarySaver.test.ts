import { saveToPhotos } from '../photoLibrarySaver'
import { File } from 'expo-file-system'
import * as MediaLibrary from 'expo-media-library/legacy'

// The seam imports the package's `legacy` subpath: the main entry re-exports
// saveToLibraryAsync only as a deprecation shim that throws at call time.
jest.mock('expo-media-library/legacy', () => ({
  requestPermissionsAsync: jest.fn(),
  saveToLibraryAsync: jest.fn(),
}))

jest.mock('expo-file-system', () => {
  class FakeFile {
    uri: string
    // Records every staged file cleaned up by the seam.
    static readonly deleteCalls = jest.fn()
    constructor(_dir: unknown, name: string) {
      this.uri = `/cache/photo-save/${name}`
      void _dir
    }
    async delete(): Promise<void> {
      FakeFile.deleteCalls()
    }
  }
  return {
    Paths: { cache: '/cache' },
    Directory: class {
      exists = false
      create(): void {}
    },
    File: Object.assign(FakeFile, { downloadFileAsync: jest.fn(async () => undefined) }),
  }
})

// The test imports the real module's TYPES; at runtime these are the fakes.
const fakeFs = File as unknown as typeof File & {
  downloadFileAsync: jest.Mock
  deleteCalls: jest.Mock
}

describe('saveToPhotos (native)', () => {
  beforeEach(() => jest.clearAllMocks())

  it('requests add-only permission and reports saved once the URI lands in the library', async () => {
    ;(MediaLibrary.requestPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true })
    ;(MediaLibrary.saveToLibraryAsync as jest.Mock).mockResolvedValue(undefined)

    await expect(saveToPhotos('file:///cache/master.webp')).resolves.toBe('saved')

    expect(MediaLibrary.requestPermissionsAsync).toHaveBeenCalledWith(true)
    expect(MediaLibrary.saveToLibraryAsync).toHaveBeenCalledWith('file:///cache/master.webp')
  })

  it('stages a remote master into cache, saves the local file, then cleans up', async () => {
    ;(MediaLibrary.requestPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true })
    fakeFs.deleteCalls.mockClear()

    await expect(
      saveToPhotos(
        'https://firebasestorage.googleapis.com/v0/b/bucket/o/character-images%2Fabc.webp?alt=media&token=t',
      ),
    ).resolves.toBe('saved')

    // Saved from the staged file:// URI, never the remote URL.
    const stagedUri = (MediaLibrary.saveToLibraryAsync as jest.Mock).mock.calls[0][0] as string
    expect(stagedUri).toMatch(/^\/cache\/photo-save\/save_.*\.webp$/)
    expect(fakeFs.downloadFileAsync).toHaveBeenCalledWith(expect.stringMatching(/^https:/), {
      uri: stagedUri,
    })
    expect(fakeFs.deleteCalls).toHaveBeenCalled()
  })

  it('does not download when permission is denied for a remote master', async () => {
    ;(MediaLibrary.requestPermissionsAsync as jest.Mock).mockResolvedValue({ granted: false })

    await expect(saveToPhotos('https://example.com/master.webp')).resolves.toBe('denied')

    expect(fakeFs.downloadFileAsync).not.toHaveBeenCalled()
    expect(MediaLibrary.saveToLibraryAsync).not.toHaveBeenCalled()
  })

  it('maps a failed download to failed and still cleans up the staging file', async () => {
    ;(MediaLibrary.requestPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true })
    fakeFs.deleteCalls.mockClear()
    fakeFs.downloadFileAsync.mockRejectedValue(new Error('offline'))

    await expect(saveToPhotos('https://example.com/master.webp')).resolves.toBe('failed')

    expect(MediaLibrary.saveToLibraryAsync).not.toHaveBeenCalled()
    expect(fakeFs.deleteCalls).toHaveBeenCalled()
  })

  it('reports denied on refusal and never touches the library', async () => {
    ;(MediaLibrary.requestPermissionsAsync as jest.Mock).mockResolvedValue({ granted: false })

    await expect(saveToPhotos('file:///cache/master.webp')).resolves.toBe('denied')

    expect(MediaLibrary.saveToLibraryAsync).not.toHaveBeenCalled()
    expect(File.downloadFileAsync).not.toHaveBeenCalled()
  })

  it('maps any bridge failure to failed instead of rejecting', async () => {
    ;(MediaLibrary.requestPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true })
    ;(MediaLibrary.saveToLibraryAsync as jest.Mock).mockRejectedValue(new Error('no space'))

    await expect(saveToPhotos('file:///cache/master.webp')).resolves.toBe('failed')
  })

  it('maps a permission-prompt crash to failed instead of rejecting', async () => {
    ;(MediaLibrary.requestPermissionsAsync as jest.Mock).mockRejectedValue(
      new Error('bridge unavailable'),
    )

    await expect(saveToPhotos('file:///cache/master.webp')).resolves.toBe('failed')
  })
})
