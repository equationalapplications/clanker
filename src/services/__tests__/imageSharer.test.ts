import { shareImage } from '../imageSharer'
import { File } from 'expo-file-system'
import * as Sharing from 'expo-sharing'

jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn(),
}))

jest.mock('expo-file-system', () => {
  class FakeFile {
    uri: string
    static readonly deleteCalls = jest.fn()
    constructor(_dir: unknown, name: string) {
      // Real File instances always carry the file:// scheme — the fake must
      // too, since the Android share bridge rejects anything else.
      this.uri = `file:///cache/photo-share/${name}`
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

const fakeFs = File as unknown as typeof File & {
  downloadFileAsync: jest.Mock
  deleteCalls: jest.Mock
}

describe('shareImage (native)', () => {
  // clearAllMocks only resets call history, NOT implementations — a
  // mockRejectedValue left over from one test would silently reroute a later
  // test through the wrong failure path, so reset the implementations the
  // failure tests below override.
  beforeEach(() => {
    jest.clearAllMocks()
    fakeFs.downloadFileAsync.mockReset().mockResolvedValue(undefined)
    ;(Sharing.isAvailableAsync as jest.Mock).mockReset().mockResolvedValue(true)
    ;(Sharing.shareAsync as jest.Mock).mockReset()
  })

  it('shares a local file URI as-is with the image mime type', async () => {
    await expect(shareImage('file:///cache/master.webp')).resolves.toBe('shared')

    expect(Sharing.shareAsync).toHaveBeenCalledWith('file:///cache/master.webp', {
      mimeType: 'image/webp',
      dialogTitle: 'Share image',
    })
  })

  it('stages a remote master into cache, shares the local file, then cleans up', async () => {
    fakeFs.deleteCalls.mockClear()

    await expect(
      shareImage(
        'https://firebasestorage.googleapis.com/v0/b/bucket/o/character-images%2Fabc.webp?alt=media&token=t',
      ),
    ).resolves.toBe('shared')

    // Shared from the staged file:// URI, never the remote URL — the native
    // bridge rejects anything but file://.
    const stagedUri = (Sharing.shareAsync as jest.Mock).mock.calls[0][0] as string
    expect(stagedUri).toMatch(/^file:\/\/\/cache\/photo-share\/share_.*\.webp$/)
    expect(fakeFs.downloadFileAsync).toHaveBeenCalledWith(expect.stringMatching(/^https:/), {
      uri: stagedUri,
    })
    expect(fakeFs.deleteCalls).toHaveBeenCalled()
  })

  it('keeps the URL extension so the share intent gets the right mime type', async () => {
    await shareImage('https://example.com/master.png?alt=media&token=t')

    const [, options] = (Sharing.shareAsync as jest.Mock).mock.calls[0] as [string, unknown]
    expect(options).toEqual({ mimeType: 'image/png', dialogTitle: 'Share image' })
  })

  it('maps a failed download to failed and never opens the share sheet', async () => {
    fakeFs.deleteCalls.mockClear()
    fakeFs.downloadFileAsync.mockRejectedValue(new Error('offline'))

    await expect(shareImage('https://example.com/master.webp')).resolves.toBe('failed')

    expect(Sharing.shareAsync).not.toHaveBeenCalled()
    expect(fakeFs.deleteCalls).toHaveBeenCalled()
  })

  it('maps a share-bridge failure to failed after cleaning up the staged file', async () => {
    ;(Sharing.shareAsync as jest.Mock).mockRejectedValue(new Error('no share sheet'))
    fakeFs.deleteCalls.mockClear()

    await expect(shareImage('https://example.com/master.webp')).resolves.toBe('failed')

    // Proves this test exercised the share-bridge path and not a leftover
    // staging failure — staging must have succeeded for the sheet to open.
    expect(fakeFs.downloadFileAsync).toHaveBeenCalled()
    expect(Sharing.shareAsync).toHaveBeenCalled()
    expect(fakeFs.deleteCalls).toHaveBeenCalled()
  })

  it('reports unavailable when the platform has no share sheet and downloads nothing', async () => {
    ;(Sharing.isAvailableAsync as jest.Mock).mockResolvedValue(false)

    await expect(shareImage('https://example.com/master.webp')).resolves.toBe('unavailable')

    expect(fakeFs.downloadFileAsync).not.toHaveBeenCalled()
    expect(Sharing.shareAsync).not.toHaveBeenCalled()
  })
})
