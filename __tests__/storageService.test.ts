const mockPutFile = jest.fn()
const mockGetDownloadURL = jest.fn()
const mockDelete = jest.fn()
const mockRefFn = jest.fn()
const mockFileBase64 = jest.fn()
const mockFileWrite = jest.fn()
const mockFileDelete = jest.fn()

jest.mock('@react-native-firebase/storage', () => ({
  getStorage: jest.fn(() => ({})),
  ref: (...a: unknown[]) => mockRefFn(...a),
  putFile: (...a: unknown[]) => mockPutFile(...a),
  getDownloadURL: (...a: unknown[]) => mockGetDownloadURL(...a),
  deleteObject: (...a: unknown[]) => mockDelete(...a),
}))
jest.mock('expo-file-system', () => ({
  Paths: { cache: { uri: 'file:///cache/' }, document: { uri: 'file:///doc/' } },
  Directory: jest.fn(() => ({ exists: true, create: jest.fn() })),
  File: jest.fn((_dir: unknown, name: string) => ({
    uri: `file:///cache/image-uploads/${name}`,
    base64: mockFileBase64,
    write: mockFileWrite,
    delete: mockFileDelete,
  })),
}))

// Mock File.downloadFileAsync as a static method
const MockFile = jest.requireMock('expo-file-system').File
MockFile.downloadFileAsync = jest.fn()

import {
  uploadImageBytes,
  getStorageDownloadUrl,
  deleteStorageObject,
  downloadImageBase64,
  __clearDownloadUrlCache,
} from '~/services/storageService'

beforeEach(() => {
  jest.clearAllMocks()
  mockFileDelete.mockReset()
  mockPutFile.mockReset()
  mockDelete.mockReset()
  __clearDownloadUrlCache()
  mockRefFn.mockImplementation((_s: unknown, path: string) => ({ fullPath: path }))
  mockGetDownloadURL.mockResolvedValue('https://cdn/x.webp')
  mockFileBase64.mockResolvedValue('DOWNLOADED64')
})

describe('storageService (native)', () => {
  it('uploads via putFile with an explicit content type', async () => {
    await uploadImageBytes('users/u/characters/c/i.webp', 'B64', 'image/webp')
    expect(mockFileWrite).toHaveBeenCalledWith('B64', { encoding: 'base64' })
    expect(mockPutFile).toHaveBeenCalledWith(
      { fullPath: 'users/u/characters/c/i.webp' },
      expect.stringMatching(/^file:\/\/\/cache\/image-uploads\/upload_/),
      { contentType: 'image/webp' },
    )
  })

  it('cleans up the staged local file after upload', async () => {
    await uploadImageBytes('users/u/characters/c/i.webp', 'B64', 'image/webp')
    expect(mockFileDelete).toHaveBeenCalledTimes(1)
  })

  it('cleans up the staged file even when the upload fails', async () => {
    mockPutFile.mockRejectedValue(new Error('network'))
    await expect(uploadImageBytes('p', 'B64', 'image/webp')).rejects.toThrow('network')
    expect(mockFileDelete).toHaveBeenCalledTimes(1)
  })

  it('does not mask the upload error when staged-file cleanup also fails', async () => {
    mockPutFile.mockRejectedValue(new Error('network'))
    mockFileDelete.mockImplementation(() => {
      throw new Error('cleanup failed')
    })
    await expect(uploadImageBytes('p', 'B64', 'image/webp')).rejects.toThrow('network')
  })

  it('memoizes download URLs per path for the session', async () => {
    await getStorageDownloadUrl('users/u/a.webp')
    await getStorageDownloadUrl('users/u/a.webp')
    expect(mockGetDownloadURL).toHaveBeenCalledTimes(1)
  })

  it('does not memoize across different paths', async () => {
    await getStorageDownloadUrl('users/u/a.webp')
    await getStorageDownloadUrl('users/u/b.webp')
    expect(mockGetDownloadURL).toHaveBeenCalledTimes(2)
  })

  it('does not cache failures', async () => {
    mockGetDownloadURL.mockRejectedValueOnce(new Error('offline'))
    await expect(getStorageDownloadUrl('users/u/a.webp')).rejects.toThrow('offline')
    mockGetDownloadURL.mockResolvedValue('https://cdn/x.webp')
    await expect(getStorageDownloadUrl('users/u/a.webp')).resolves.toBe('https://cdn/x.webp')
  })

  it('treats deleting a missing object as success', async () => {
    mockDelete.mockRejectedValue(
      Object.assign(new Error('nope'), { code: 'storage/object-not-found' }),
    )
    await expect(deleteStorageObject('users/u/gone.webp')).resolves.toBeUndefined()
  })

  it('propagates non-not-found delete errors', async () => {
    mockDelete.mockRejectedValue(
      Object.assign(new Error('denied'), { code: 'storage/unauthorized' }),
    )
    await expect(deleteStorageObject('users/u/x.webp')).rejects.toThrow('denied')
  })

  it('downloads an object to base64', async () => {
    await expect(downloadImageBase64('users/u/a.webp')).resolves.toBe('DOWNLOADED64')
  })
})
