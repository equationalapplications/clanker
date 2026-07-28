import {
  resolveImageUri,
  writeLocalImageBytes,
  deleteLocalImageBytes,
} from '~/services/localImageStore.web'
import type { CharacterImageRow } from '~/database/characterImageDatabase'

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

  it('rejects cloud rows until the Storage seam lands', async () => {
    await expect(
      resolveImageUri(
        row({ storage_kind: 'cloud', master_ref: 'characters/char_a/img-1.webp' }),
        'master',
      ),
    ).rejects.toThrow(/cloud image resolution/i)
  })
})
