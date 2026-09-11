import { shareImage } from '../imageSharer'
import { File } from 'expo-file-system'
import * as Sharing from 'expo-sharing'

jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn(),
}))

// Mirrors the real expo-file-system surface the seam touches: File instances
// register themselves so Directory.list() can hand them back for the stale
// sweep, and each File carries its own delete spy so a test can prove which
// file was (or was not) reclaimed.
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

const fakeFs = File as unknown as typeof File & {
  downloadFileAsync: jest.Mock
  instances: { uri: string; delete: jest.Mock }[]
}

/** A staged-file stand-in with an embedded timestamp, as stagedFileFor mints. */
function fakeStaleShare(ageMs: number): { uri: string; delete: jest.Mock } {
  const stamped = Date.now() - ageMs
  return { uri: `file:///cache/photo-share/share_${stamped}_old.webp`, delete: jest.fn() }
}

describe('shareImage (native)', () => {
  // clearAllMocks only resets call history, NOT implementations — a
  // mockRejectedValue left over from one test would silently reroute a later
  // test through the wrong failure path, so reset the implementations the
  // failure tests below override.
  beforeEach(() => {
    jest.clearAllMocks()
    fakeFs.instances.length = 0
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

  it('stages a remote master into cache and shares the local file, never the URL', async () => {
    await expect(
      shareImage(
        'https://firebasestorage.googleapis.com/v0/b/bucket/o/character-images%2Fabc.webp?alt=media&token=t',
      ),
    ).resolves.toBe('shared')

    // Shared from the staged file:// URI, never the remote URL — the native
    // bridge rejects anything but file://.
    const stagedUri = (Sharing.shareAsync as jest.Mock).mock.calls[0][0] as string
    expect(stagedUri).toMatch(/^file:\/\/\/cache\/photo-share\/share_.*\.webp$/)
    expect(fakeFs.downloadFileAsync).toHaveBeenCalledWith(
      expect.stringMatching(/^https:/),
      // A File instance, not a plain {uri} object — match on the uri only.
      expect.objectContaining({ uri: stagedUri }),
    )
  })

  it('keeps the staged file after the share resolves — the target app reads it lazily', async () => {
    // On Android the shareAsync promise resolves in OnActivityResult, the
    // moment the user returns to this app — potentially before the target has
    // opened the content:// URI. Deleting on resolve hands the target a
    // deleted file (WhatsApp/Gmail show a broken attachment).
    await shareImage('https://example.com/master.webp')

    const staged = fakeFs.instances.find((f) => /photo-share\/share_.*\.webp$/.test(f.uri))
    expect(staged).toBeDefined()
    expect(staged!.delete).not.toHaveBeenCalled()
  })

  it('reclaims staged files from shares that started over an hour ago', async () => {
    const stale = fakeStaleShare(2 * 60 * 60 * 1000)
    fakeFs.instances.push(stale)

    await shareImage('https://example.com/master.webp')

    expect(stale.delete).toHaveBeenCalled()
  })

  it('keeps staged files from shares that may still be in flight', async () => {
    const recent = fakeStaleShare(30 * 1000)
    fakeFs.instances.push(recent)

    await shareImage('https://example.com/master.webp')

    expect(recent.delete).not.toHaveBeenCalled()
  })

  it('keeps the URL extension so the share intent gets the right mime type', async () => {
    await shareImage('https://example.com/master.png?alt=media&token=t')

    const [, options] = (Sharing.shareAsync as jest.Mock).mock.calls[0] as [string, unknown]
    expect(options).toEqual({ mimeType: 'image/png', dialogTitle: 'Share image' })
  })

  it('maps a failed download to failed and never opens the share sheet', async () => {
    fakeFs.downloadFileAsync.mockRejectedValue(new Error('offline'))

    await expect(shareImage('https://example.com/master.webp')).resolves.toBe('failed')

    expect(Sharing.shareAsync).not.toHaveBeenCalled()
  })

  it('maps a share-bridge failure to failed', async () => {
    ;(Sharing.shareAsync as jest.Mock).mockRejectedValue(new Error('no share sheet'))

    await expect(shareImage('https://example.com/master.webp')).resolves.toBe('failed')

    // Proves this test exercised the share-bridge path and not a leftover
    // staging failure — staging must have succeeded for the sheet to open.
    expect(fakeFs.downloadFileAsync).toHaveBeenCalled()
    expect(Sharing.shareAsync).toHaveBeenCalled()
  })

  it('reports unavailable when the platform has no share sheet and downloads nothing', async () => {
    ;(Sharing.isAvailableAsync as jest.Mock).mockResolvedValue(false)

    await expect(shareImage('https://example.com/master.webp')).resolves.toBe('unavailable')

    expect(fakeFs.downloadFileAsync).not.toHaveBeenCalled()
    expect(Sharing.shareAsync).not.toHaveBeenCalled()
  })
})
