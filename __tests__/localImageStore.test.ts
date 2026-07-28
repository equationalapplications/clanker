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

const MockDirectory = jest.mocked(Directory)
const MockFile = jest.mocked(File)
const written: Array<{ uri: string; base64: string }> = []
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
      write: (data: string) => written.push({ uri, base64: data }),
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

  it('writes bytes under the document directory and returns the ref', async () => {
    const ref = await writeLocalImageBytes('img-1', 'BYTES', 'master')
    expect(ref).toBe('file:///doc/character-images/img-1.webp')
    expect(written).toEqual([{ uri: 'file:///doc/character-images/img-1.webp', base64: 'BYTES' }])
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

  it('deletes bytes by ref', async () => {
    await deleteLocalImageBytes('file:///doc/character-images/img-1.webp')
    expect(deleted).toEqual(['file:///doc/character-images/img-1.webp'])
  })

  it('treats deleting an already-missing file as success', async () => {
    MockFile.mockImplementation(
      () =>
        ({
          delete: () => {
            throw new Error('ENOENT')
          },
        }) as never,
    )
    await expect(deleteLocalImageBytes('file:///gone.webp')).resolves.toBeUndefined()
  })
})
