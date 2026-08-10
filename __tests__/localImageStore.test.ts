import { Directory, File, Paths } from 'expo-file-system'
import {
  resolveImageUri,
  writeLocalImageBytes,
  deleteLocalImageBytes,
} from '~/services/localImageStore'
import type { CharacterImageRow } from '~/database/characterImageDatabase'

jest.mock('expo-file-system', () => ({
  Paths: { document: { uri: 'file:///doc/' } },
  Directory: jest.fn(),
  File: jest.fn(),
}))
jest.mock('~/services/storageService', () => ({
  getStorageDownloadUrl: jest.fn(async (path: string) => `https://cdn/${path}`),
}))

const MockDirectory = jest.mocked(Directory)
const MockFile = jest.mocked(File)
const written: Array<{ uri: string; base64: string; options?: unknown }> = []
const deleted: string[] = []
let dirExists = true

/** `Directory`/`File` accept string URIs or other path instances; both expose `uri`. */
function uriOf(value: unknown): string {
  if (typeof value === 'string') return value
  return String((value as { uri?: string }).uri ?? '')
}

beforeEach(() => {
  jest.clearAllMocks()
  written.length = 0
  deleted.length = 0
  dirExists = true
  MockDirectory.mockImplementation((...args: unknown[]) => {
    const parent = args.length > 1 ? uriOf(args[0]) : ''
    const name = args.length > 1 ? String(args[1]) : String(args[0])
    return {
      uri: `${parent}${name}/`,
      get exists() {
        return dirExists
      },
      create: jest.fn(() => {
        dirExists = true
      }),
    } as never
  })
  MockFile.mockImplementation((...args: unknown[]) => {
    const uri = args.length > 1 ? `${uriOf(args[0])}${String(args[1])}` : String(args[0])
    return {
      uri,
      write: (data: string, options?: unknown) => written.push({ uri, base64: data, options }),
      delete: () => deleted.push(uri),
      exists: true,
    } as never
  })
})

function row(overrides: Partial<CharacterImageRow>): CharacterImageRow {
  return {
    id: 'img-1',
    character_id: 'char_a',
    user_id: 'user-1',
    storage_kind: 'inline',
    master_ref: 'MASTER64',
    thumb_ref: null,
    mime_type: 'image/webp',
    source: 'generated',
    sync_state: 'local',
    sync_attempts: 0,
    created_at: 1,
    deleted_at: null,
    message_id: null,
    ...overrides,
  }
}

describe('localImageStore (native)', () => {
  it('returns file:// refs unchanged', async () => {
    const r = row({ storage_kind: 'file', master_ref: 'file:///doc/images/img-1.webp' })
    await expect(resolveImageUri(r, 'master')).resolves.toBe('file:///doc/images/img-1.webp')
  })

  it('builds a data URI for inline rows using the row mime type', async () => {
    const r = row({ storage_kind: 'inline', master_ref: 'MASTER64', mime_type: 'image/jpeg' })
    await expect(resolveImageUri(r, 'master')).resolves.toBe('data:image/jpeg;base64,MASTER64')
  })

  it('resolves the thumb variant when thumb_ref is present', async () => {
    const r = row({ storage_kind: 'inline', master_ref: 'M', thumb_ref: 'T' })
    await expect(resolveImageUri(r, 'thumb')).resolves.toBe('data:image/webp;base64,T')
  })

  it('falls back to the master when thumb_ref is NULL', async () => {
    const r = row({ storage_kind: 'inline', master_ref: 'M', thumb_ref: null })
    await expect(resolveImageUri(r, 'thumb')).resolves.toBe('data:image/webp;base64,M')
  })

  it('resolves cloud rows to a download URL', async () => {
    const r = row({ storage_kind: 'cloud', master_ref: 'users/u/characters/c/img-1.webp' })
    await expect(resolveImageUri(r, 'master')).resolves.toBe(
      'https://cdn/users/u/characters/c/img-1.webp',
    )
  })

  it('resolves the cloud thumb path when present', async () => {
    const r = row({
      storage_kind: 'cloud',
      master_ref: 'users/u/characters/c/img-1.webp',
      thumb_ref: 'users/u/characters/c/img-1_thumb.webp',
    })
    await expect(resolveImageUri(r, 'thumb')).resolves.toBe(
      'https://cdn/users/u/characters/c/img-1_thumb.webp',
    )
  })

  it('writes bytes as base64, not as utf8 text', async () => {
    const ref = await writeLocalImageBytes('img-1', 'BYTES', 'master')
    expect(ref).toBe('file:///doc/character-images/img-1.webp')
    expect(written).toEqual([
      {
        uri: 'file:///doc/character-images/img-1.webp',
        base64: 'BYTES',
        options: { encoding: 'base64' },
      },
    ])
  })

  it('names the thumb variant distinctly so it cannot clobber the master', async () => {
    const ref = await writeLocalImageBytes('img-1', 'BYTES', 'thumb')
    expect(ref).toBe('file:///doc/character-images/img-1_thumb.webp')
  })

  it('creates the image directory when it does not exist yet', async () => {
    dirExists = false
    await writeLocalImageBytes('img-1', 'BYTES', 'master')
    expect(dirExists).toBe(true)
  })

  it('rejects ids that could escape the image directory', async () => {
    for (const bad of ['../escape', 'a/b', 'img 1', '', 'img.1']) {
      await expect(writeLocalImageBytes(bad, 'BYTES', 'master')).rejects.toThrow(/unsafe image id/i)
    }
    expect(written).toEqual([])
  })

  it('deletes bytes by ref', async () => {
    await deleteLocalImageBytes('file:///doc/character-images/img-1.webp')
    expect(deleted).toEqual(['file:///doc/character-images/img-1.webp'])
  })

  it('treats deleting an already-missing file as success', async () => {
    MockFile.mockImplementation(
      () =>
        ({
          exists: false,
          delete: () => {
            throw new Error('should not be called')
          },
        }) as never,
    )
    await expect(deleteLocalImageBytes('file:///gone.webp')).resolves.toBeUndefined()
  })

  it('propagates real delete failures instead of reporting success', async () => {
    MockFile.mockImplementation(
      () =>
        ({
          exists: true,
          delete: () => {
            throw new Error('EPERM')
          },
        }) as never,
    )
    await expect(deleteLocalImageBytes('file:///locked.webp')).rejects.toThrow('EPERM')
  })
})
