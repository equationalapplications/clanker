const mockUploadBytes = jest.fn()
const mockGetDownloadURL = jest.fn()
const mockDeleteObject = jest.fn()

jest.mock('firebase/storage', () => ({
  getStorage: jest.fn(() => ({})),
  ref: jest.fn((_s: unknown, path: string) => ({ fullPath: path })),
  uploadBytes: (...a: unknown[]) => mockUploadBytes(...a),
  getDownloadURL: (...a: unknown[]) => mockGetDownloadURL(...a),
  deleteObject: (...a: unknown[]) => mockDeleteObject(...a),
}))
jest.mock('~/config/firebaseConfig.web', () => ({ firebaseApp: {} }))

// FileReader is not available in Node.js test environment
class MockFileReader {
  onerror: (() => void) | null = null
  onload: (() => void) | null = null
  result: string | null = null
  error: Error | null = null
  readAsDataURL(_blob: Blob) {
    this.result = 'data:image/webp;base64,AQID'
    // Use process.nextTick for sync-like async in Node
    if (this.onload) process.nextTick(this.onload)
  }
}
// @ts-expect-error test environment
global.FileReader = MockFileReader

import {
  uploadImageBytes,
  getStorageDownloadUrl,
  deleteStorageObject,
  downloadImageBase64,
  __clearDownloadUrlCache,
} from '~/services/storageService.web'

const realFetch = global.fetch

beforeEach(() => {
  jest.clearAllMocks()
  __clearDownloadUrlCache()
  mockGetDownloadURL.mockResolvedValue('https://cdn/x.webp')
})

afterEach(() => { global.fetch = realFetch })

describe('storageService (web)', () => {
  it('uploads a Blob with the declared content type', async () => {
    await uploadImageBytes('users/u/a.webp', btoa('bytes'), 'image/webp')
    const [, blob, meta] = mockUploadBytes.mock.calls[0] as [unknown, Blob, { contentType: string }]
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.type).toBe('image/webp')
    expect(meta).toEqual({ contentType: 'image/webp' })
  })

  it('memoizes download URLs per path', async () => {
    await getStorageDownloadUrl('users/u/a.webp')
    await getStorageDownloadUrl('users/u/a.webp')
    expect(mockGetDownloadURL).toHaveBeenCalledTimes(1)
  })

  it('treats a missing object as deleted', async () => {
    mockDeleteObject.mockRejectedValue(Object.assign(new Error('x'), { code: 'storage/object-not-found' }))
    await expect(deleteStorageObject('users/u/a.webp')).resolves.toBeUndefined()
  })

  it('downloads through fetch and returns base64 without the data-URI prefix', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      blob: async () => new Blob([Uint8Array.from([1, 2, 3])], { type: 'image/webp' }),
    })) as never
    const result = await downloadImageBase64('users/u/a.webp')
    expect(result).not.toContain('data:')
    expect(typeof result).toBe('string')
  })
})