import { getImageAttachment } from '~/services/imageModelBytes'
import { getCharacterImageById } from '~/database/characterImageDatabase'
import { resolveImageUri } from '~/services/localImageStore'

jest.mock('~/database/characterImageDatabase')
// Factory (not a bare mock) because `localImageStore` transitively imports
// `storageService`, which pulls in Firebase modules that fail to load under jest.
jest.mock('~/services/localImageStore', () => ({
  resolveImageUri: jest.fn(),
}))

const row = {
  id: 'img-1',
  character_id: 'char-1',
  user_id: 'user-1',
  storage_kind: 'cloud' as const,
  master_ref: 'users/u/characters/c/img-1.webp',
  thumb_ref: null,
  mime_type: 'image/webp',
  source: 'chat' as const,
  sync_state: 'synced' as const,
  sync_attempts: 0,
  created_at: 1,
  deleted_at: null,
  message_id: 'msg-1',
}

beforeEach(() => {
  jest.resetAllMocks()
  ;(getCharacterImageById as jest.Mock).mockResolvedValue(row)
  // Spy on fetch so the data-URI test can assert no network round-trip happened.
  jest.spyOn(global, 'fetch').mockImplementation(() => Promise.resolve(new Response()))
})

it('reads a data: URI without a network round-trip', async () => {
  ;(resolveImageUri as jest.Mock).mockResolvedValue('data:image/webp;base64,AAAA')

  await expect(getImageAttachment('img-1')).resolves.toEqual({
    mimeType: 'image/webp',
    data: 'AAAA',
  })
  expect(global.fetch).not.toHaveBeenCalled()
})

it('returns null when the row is gone rather than throwing', async () => {
  ;(getCharacterImageById as jest.Mock).mockResolvedValue(null)
  await expect(getImageAttachment('img-1')).resolves.toBeNull()
})

it('returns null when the mime type is not an allowed attachment type', async () => {
  ;(getCharacterImageById as jest.Mock).mockResolvedValue({ ...row, mime_type: 'image/svg+xml' })
  ;(resolveImageUri as jest.Mock).mockResolvedValue('data:image/svg+xml;base64,AAAA')

  await expect(getImageAttachment('img-1')).resolves.toBeNull()
})

it('returns null when the image cannot be resolved', async () => {
  ;(resolveImageUri as jest.Mock).mockResolvedValue(null)
  await expect(getImageAttachment('img-1')).resolves.toBeNull()
})
