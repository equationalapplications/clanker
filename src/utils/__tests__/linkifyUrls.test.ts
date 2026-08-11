import { linkifyUrls } from '../linkifyUrls'

describe('linkifyUrls', () => {
  it('returns a single text segment when there are no URLs', () => {
    expect(linkifyUrls('hello world')).toEqual([
      { type: 'text', value: 'hello world' },
    ])
  })

  it('splits a string on a URL', () => {
    expect(linkifyUrls('see https://example.com today')).toEqual([
      { type: 'text', value: 'see ' },
      { type: 'url', value: 'https://example.com' },
      { type: 'text', value: ' today' },
    ])
  })

  it('preserves URL-only input', () => {
    expect(linkifyUrls('https://example.com')).toEqual([
      { type: 'url', value: 'https://example.com' },
    ])
  })

  it('does not match email addresses', () => {
    expect(linkifyUrls('mail me at user@example.com')).toEqual([
      { type: 'text', value: 'mail me at user@example.com' },
    ])
  })

  it('does not match phone numbers', () => {
    expect(linkifyUrls('call 555-123-4567')).toEqual([
      { type: 'text', value: 'call 555-123-4567' },
    ])
  })

  it('matches multiple URLs in one string', () => {
    expect(linkifyUrls('first https://a.com and http://b.com')).toEqual([
      { type: 'text', value: 'first ' },
      { type: 'url', value: 'https://a.com' },
      { type: 'text', value: ' and ' },
      { type: 'url', value: 'http://b.com' },
    ])
  })
})