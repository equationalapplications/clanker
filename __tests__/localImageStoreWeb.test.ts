import {
  resolveImageUri,
  writeLocalImageBytes,
  deleteLocalImageBytes,
} from '~/services/localImageStore.web'
import type { CharacterImageRow } from '~/database/characterImageDatabase'

jest.mock('~/services/storageService.web', () => ({
  getStorageDownloadUrl: jest.fn(async (path: string) => `https://cdn/${path}`),
}))

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

describe('localImageStore (web)', () => {
  it('builds data URIs for inline rows', async () => {
    await expect(resolveImageUri(row({}), 'master')).resolves.toBe(
      'data:image/webp;base64,MASTER64',
    )
  })

  it('falls back to the master when thumb_ref is NULL', async () => {
    await expect(resolveImageUri(row({}), 'thumb')).resolves.toBe(
      'data:image/webp;base64,MASTER64',
    )
  })

  it('returns the base64 unchanged as the ref — bytes live in the row on web', async () => {
    await expect(writeLocalImageBytes('img-1', 'BYTES', 'master')).resolves.toBe('BYTES')
  })

  it('deleting is a no-op on web because the row holds the bytes', async () => {
    await expect(deleteLocalImageBytes('BYTES')).resolves.toBeUndefined()
  })

  it('rejects file refs, which cannot exist on web', async () => {
    await expect(
      resolveImageUri(row({ storage_kind: 'file', master_ref: 'file://x' }), 'master'),
    ).rejects.toThrow(/file-backed images are not available on web/i)
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
})
