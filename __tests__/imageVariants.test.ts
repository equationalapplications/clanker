import { manipulateAsync, SaveFormat } from 'expo-image-manipulator'
import { File } from 'expo-file-system'
import { prepareImageVariants, MASTER_DIMENSION, THUMB_DIMENSION } from '~/services/imageVariants'

jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn(),
  SaveFormat: { WEBP: 'webp', JPEG: 'jpeg', PNG: 'png' },
}))
jest.mock('expo-file-system', () => ({ File: jest.fn() }))
jest.mock('~/utilities/webpSupport', () => ({
  getEncodeTarget: () => ({ format: 'webp', mimeType: 'image/webp' }),
}))

const mockManipulate = jest.mocked(manipulateAsync)
const MockFile = jest.mocked(File)
const deleted: string[] = []

function setupFiles(base64ByUri: Record<string, string>) {
  deleted.length = 0
  MockFile.mockImplementation((uri: unknown) => {
    const key = String(uri)
    return {
      base64: async () => base64ByUri[key] ?? 'UNKNOWN',
      delete: () => {
        deleted.push(key)
      },
    } as never
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  setupFiles({ 'file://master.webp': 'MASTER64', 'file://thumb.webp': 'THUMB64' })
  mockManipulate
    .mockResolvedValueOnce({ uri: 'file://master.webp', width: 1024, height: 1024 } as never)
    .mockResolvedValueOnce({ uri: 'file://thumb.webp', width: 256, height: 256 } as never)
})

describe('prepareImageVariants', () => {
  it('exposes the spec dimensions', () => {
    expect(MASTER_DIMENSION).toBe(1024)
    expect(THUMB_DIMENSION).toBe(256)
  })

  it('returns base64 master and thumb tagged with the encode target mime', async () => {
    const result = await prepareImageVariants({
      uri: 'file://source.jpg',
      width: 2048,
      height: 2048,
    })
    expect(result).toEqual({
      master: { base64: 'MASTER64', mimeType: 'image/webp' },
      thumb: { base64: 'THUMB64', mimeType: 'image/webp' },
    })
  })

  it('resizes the master on the longest edge when the source is oversized', async () => {
    await prepareImageVariants({ uri: 'file://source.jpg', width: 4000, height: 2000 })
    expect(mockManipulate.mock.calls[0][1]).toEqual([{ resize: { width: 1024 } }])
  })

  it('resizes on height when the source is taller than it is wide', async () => {
    await prepareImageVariants({ uri: 'file://source.jpg', width: 2000, height: 4000 })
    expect(mockManipulate.mock.calls[0][1]).toEqual([{ resize: { height: 1024 } }])
  })

  it('never upscales: an 800x800 source is left at 800', async () => {
    await prepareImageVariants({ uri: 'file://source.jpg', width: 800, height: 800 })
    expect(mockManipulate.mock.calls[0][1]).toEqual([])
  })

  it('always derives the thumb from the master at 256', async () => {
    await prepareImageVariants({ uri: 'file://source.jpg', width: 800, height: 800 })
    expect(mockManipulate.mock.calls[1][0]).toBe('file://master.webp')
    expect(mockManipulate.mock.calls[1][1]).toEqual([{ resize: { width: 256 } }])
  })

  it('deletes both temp files even when the caller succeeds', async () => {
    await prepareImageVariants({ uri: 'file://source.jpg', width: 800, height: 800 })
    expect(deleted).toEqual(expect.arrayContaining(['file://master.webp', 'file://thumb.webp']))
  })

  it('deletes temp files when reading base64 throws', async () => {
    MockFile.mockImplementation(
      (uri: unknown) =>
        ({
          base64: async () => {
            throw new Error('read failed')
          },
          delete: () => {
            deleted.push(String(uri))
          },
        }) as never,
    )
    await expect(
      prepareImageVariants({ uri: 'file://source.jpg', width: 800, height: 800 }),
    ).rejects.toThrow('read failed')
    expect(deleted).toContain('file://master.webp')
  })
})
