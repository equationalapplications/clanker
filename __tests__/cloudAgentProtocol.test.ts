import {
  ATTACHMENT_MIME_TYPES,
  MAX_ATTACHMENTS_PER_TURN,
  MAX_ATTACHMENT_BASE64_CHARS,
  isAttachmentMimeType,
} from '../shared/cloudAgentAttachments'

describe('cloudAgentAttachments', () => {
  it('admits exactly the two types storage.rules admits', () => {
    expect([...ATTACHMENT_MIME_TYPES]).toEqual(['image/webp', 'image/jpeg'])
  })

  it('caps a turn at one attachment in Phase 2', () => {
    expect(MAX_ATTACHMENTS_PER_TURN).toBe(1)
  })

  it('caps base64 length at 1,400,000 chars', () => {
    expect(MAX_ATTACHMENT_BASE64_CHARS).toBe(1_400_000)
  })

  it('narrows unknown mime types', () => {
    expect(isAttachmentMimeType('image/webp')).toBe(true)
    expect(isAttachmentMimeType('image/svg+xml')).toBe(false)
    expect(isAttachmentMimeType('text/html')).toBe(false)
  })
})
