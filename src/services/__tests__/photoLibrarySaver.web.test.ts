/**
 * The ONLY suite that executes the web twin of the photo-save seam.
 *
 * Jest resolves the bare `~/services/photoLibrarySaver` specifier to the
 * native .ts twin (jest-expo has no platform-suffix mapping), so without this
 * explicit-extension import nothing in CI ever loads photoLibrarySaver.web.ts.
 * That matters beyond coverage: if `expo-media-library` ever enters this
 * file's import graph, its main entry calls requireNativeModule at module
 * scope and THIS import throws under Jest — catching the exact web-crash
 * class the seam exists to prevent, which tsc and every other suite are blind
 * to.
 *
 * The react-native environment has no browser globals, so every DOM API the
 * twin touches is stubbed here.
 */
import { saveToPhotos } from '../photoLibrarySaver.web'

const mockAnchorClick = jest.fn()
const mockAppendChild = jest.fn()
const mockRemoveChild = jest.fn()
const mockFetch = jest.fn(async () => ({
  ok: true,
  blob: async () => ({ type: 'image/webp' }),
}))

// See imageSharer.web.test.ts for why the real URL constructor is augmented
// rather than replaced: the twin's filename parsing needs `new URL(...)`.
const realUrl = globalThis.URL as unknown as Record<string, unknown>
const mockCreateObjectURL = jest.fn((_: unknown) => 'blob:fake')
const mockRevokeObjectURL = jest.fn()

beforeEach(() => {
  jest.clearAllMocks()
  const g = globalThis as Record<string, unknown>
  g.fetch = mockFetch
  g.document = {
    createElement: () => ({ click: mockAnchorClick, href: '', download: '' }),
    body: { appendChild: mockAppendChild, removeChild: mockRemoveChild },
  }
  realUrl.createObjectURL = mockCreateObjectURL
  realUrl.revokeObjectURL = mockRevokeObjectURL
})

afterEach(() => {
  const g = globalThis as Record<string, unknown>
  delete g.fetch
  delete g.document
  delete realUrl.createObjectURL
  delete realUrl.revokeObjectURL
})

describe('saveToPhotos (web twin)', () => {
  it('downloads the image through a browser anchor and reports downloaded', async () => {
    await expect(saveToPhotos('https://example.com/master.webp?token=t')).resolves.toBe(
      'downloaded',
    )

    expect(mockFetch).toHaveBeenCalledWith('https://example.com/master.webp?token=t')
    expect(mockAnchorClick).toHaveBeenCalled()
    expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:fake')
  })

  it('loads without any native module or react-native import', async () => {
    // Import-time assertion by proxy: reaching this point means the module
    // graph contained nothing requiring a native bridge.
    expect(typeof saveToPhotos).toBe('function')
  })

  it('maps a failed fetch to failed instead of rejecting', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, blob: async () => ({ type: '' }) })

    await expect(saveToPhotos('https://example.com/master.webp')).resolves.toBe('failed')

    expect(mockAnchorClick).not.toHaveBeenCalled()
  })
})
