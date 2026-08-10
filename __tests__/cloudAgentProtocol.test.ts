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

import { agentRunSchema } from '../shared/cloudAgentProtocol'

const CHARACTER_ID = '11111111-1111-4111-8111-111111111111'
const base = { message: 'hello', characterId: CHARACTER_ID }
const attachment = { mimeType: 'image/webp', data: 'AAAA' }

describe('agentRunSchema', () => {
  const cases: Array<[string, unknown, boolean]> = [
    ['plain text turn', base, true],
    ['text with one attachment', { ...base, attachments: [attachment] }, true],
    ['captionless photo', { message: '', characterId: CHARACTER_ID, attachments: [attachment] }, true],
    ['whitespace-only caption with a photo', { message: '   ', characterId: CHARACTER_ID, attachments: [attachment] }, true],
    ['empty text with no attachment', { message: '', characterId: CHARACTER_ID }, false],
    ['whitespace-only text with no attachment', { message: '   ', characterId: CHARACTER_ID }, false],
    ['non-uuid characterId', { message: 'hi', characterId: 'char_local_1' }, false],
    ['disallowed mime type', { ...base, attachments: [{ mimeType: 'image/svg+xml', data: 'AAAA' }] }, false],
    ['two attachments', { ...base, attachments: [attachment, attachment] }, false],
    ['oversized data', { ...base, attachments: [{ mimeType: 'image/webp', data: 'A'.repeat(1_400_001) }] }, false],
    ['empty data', { ...base, attachments: [{ mimeType: 'image/webp', data: '' }] }, false],
    ['ws envelope fields tolerated', { ...base, type: 'agent_run', timezone: 'Europe/London' }, true],
    ['history of content parts', { ...base, history: [{ role: 'user', parts: [{ text: 'earlier' }] }] }, true],
    ['history with empty parts', { ...base, history: [{ role: 'user', parts: [] }] }, false],
  ]

  it.each(cases)('%s → %s', (_name, input, expected) => {
    expect(agentRunSchema.safeParse(input).success).toBe(expected)
  })

  it('trims the message so a padded caption is not treated as text', () => {
    const parsed = agentRunSchema.parse({ message: '  hi  ', characterId: CHARACTER_ID })
    expect(parsed.message).toBe('hi')
  })
})
