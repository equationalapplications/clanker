/**
 * The ONLY suite that executes the web twin of the image-share seam.
 *
 * Jest resolves the bare `~/services/imageSharer` specifier to the native .ts
 * twin (jest-expo has no platform-suffix mapping), so without this
 * explicit-extension import nothing in CI ever loads imageSharer.web.ts.
 *
 * The jest-expo preset runs under a react-native environment with no DOM, so
 * every browser global the twin touches is stubbed here.
 */
import { shareImage } from '../imageSharer.web'

const mockShare = jest.fn()
const mockCanShare = jest.fn((_data: { files?: unknown }): boolean => true)
const mockCreateObjectURL = jest.fn((_: unknown) => 'blob:fake')
const mockRevokeObjectURL = jest.fn()
const mockAnchorClick = jest.fn()
const mockAppendChild = jest.fn()
const mockRemoveChild = jest.fn()

type FakeShareFile = { name: string; type: string }

// Minimal stand-ins for the react-native test environment's missing browser
// globals. `FakeFileConstructor` records what the twin tried to share; it
// mirrors the real File signature `new File(parts, name, options)`.
const mockFileConstructor = jest.fn(
  (parts: unknown[], name: string, options?: { type?: string }) => ({
    parts,
    name,
    type: options?.type,
  }),
)

const mockFetch = jest.fn(async () => ({ ok: true, blob: async () => ({ type: 'image/webp' }) }))

// The react-native environment has no browser globals, and this preset's jest
// object lacks stubGlobal — assign directly and restore in afterEach. The real
// URL constructor stays reachable: the twin's filename parsing needs it, only
// the object-URL helpers are faked (Node's URL has no static object-URL API).
const realUrl = globalThis.URL as unknown as Record<string, unknown>
beforeEach(() => {
  jest.clearAllMocks()
  const g = globalThis as Record<string, unknown>
  g.File = mockFileConstructor
  realUrl.createObjectURL = mockCreateObjectURL
  realUrl.revokeObjectURL = mockRevokeObjectURL
  g.fetch = mockFetch
  g.navigator = {
    share: mockShare,
    canShare: (data: { files?: FakeShareFile[] }) => mockCanShare(data),
  }
  g.document = {
    createElement: () => ({ click: mockAnchorClick, href: '', download: '' }),
    body: { appendChild: mockAppendChild, removeChild: mockRemoveChild },
  }
})

afterEach(() => {
  const g = globalThis as Record<string, unknown>
  delete g.File
  delete g.fetch
  delete g.navigator
  delete g.document
  delete realUrl.createObjectURL
  delete realUrl.revokeObjectURL
})

describe('shareImage (web twin)', () => {
  it('shares the fetched image bytes through navigator.share, not the raw URL', async () => {
    await expect(shareImage('https://example.com/master.webp?token=t')).resolves.toBe('shared')

    expect(globalThis.fetch).toHaveBeenCalledWith('https://example.com/master.webp?token=t')
    expect(mockShare).toHaveBeenCalledWith({
      files: [expect.objectContaining({ type: 'image/webp' })],
    })
    // The tokenized URL must never be shared on its own — that was the
    // original bug: the sheet opened but shared an expiring link, not bytes.
    expect(mockShare).not.toHaveBeenCalledWith(expect.objectContaining({ url: expect.any(String) }))
  })

  it('names the shared file after the URL so targets keep the extension', async () => {
    await shareImage('https://example.com/master.webp?token=t')

    const name = mockFileConstructor.mock.calls[0][1] as string
    expect(name).toBe('master.webp')
  })

  it('reports cancelled when the user dismisses the share sheet', async () => {
    mockShare.mockRejectedValue(Object.assign(new Error('user cancelled'), { name: 'AbortError' }))

    await expect(shareImage('https://example.com/master.webp')).resolves.toBe('cancelled')
  })

  it('falls back to a browser download when navigator.share cannot take files', async () => {
    mockCanShare.mockReturnValue(false)

    await expect(shareImage('https://example.com/master.webp')).resolves.toBe('downloaded')

    expect(mockShare).not.toHaveBeenCalled()
    expect(mockAnchorClick).toHaveBeenCalled()
    expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:fake')
  })

  it('maps a failed fetch to failed instead of rejecting', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, blob: async () => ({ type: '' }) })

    await expect(shareImage('https://example.com/master.webp')).resolves.toBe('failed')

    expect(mockShare).not.toHaveBeenCalled()
    expect(mockAnchorClick).not.toHaveBeenCalled()
  })

  it('falls back to a download when the File constructor throws', async () => {
    // The seam's contract is never-rejects: some embedded browsers throw on
    // `new File(...)`, and the bytes are still in hand, so degrade to the
    // download instead of surfacing an unhandled rejection.
    mockFileConstructor.mockImplementation(() => {
      throw new TypeError('File constructor unavailable')
    })

    await expect(shareImage('https://example.com/master.webp')).resolves.toBe('downloaded')

    expect(mockShare).not.toHaveBeenCalled()
    expect(mockAnchorClick).toHaveBeenCalled()
  })

  it('falls back to a download when the canShare probe throws', async () => {
    mockCanShare.mockImplementation(() => {
      throw new Error('canShare failed')
    })

    await expect(shareImage('https://example.com/master.webp')).resolves.toBe('downloaded')

    expect(mockShare).not.toHaveBeenCalled()
    expect(mockAnchorClick).toHaveBeenCalled()
  })

  it('maps a download-fallback failure to failed instead of rejecting', async () => {
    mockCanShare.mockReturnValue(false)
    mockCreateObjectURL.mockImplementation(() => {
      throw new Error('no object URLs')
    })

    await expect(shareImage('https://example.com/master.webp')).resolves.toBe('failed')

    expect(mockShare).not.toHaveBeenCalled()
    expect(mockAnchorClick).not.toHaveBeenCalled()
  })
})
