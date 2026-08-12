import { linkifyUrls } from '../linkifyUrls'

describe('linkifyUrls', () => {
  it('returns a single text segment when there are no URLs', () => {
    expect(linkifyUrls('hello world')).toEqual([{ type: 'text', value: 'hello world' }])
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
    expect(linkifyUrls('call 555-123-4567')).toEqual([{ type: 'text', value: 'call 555-123-4567' }])
  })

  it('matches multiple URLs in one string', () => {
    expect(linkifyUrls('first https://a.com and http://b.com')).toEqual([
      { type: 'text', value: 'first ' },
      { type: 'url', value: 'https://a.com' },
      { type: 'text', value: ' and ' },
      { type: 'url', value: 'http://b.com' },
    ])
  })

  it('leaves a sentence-ending period out of the URL', () => {
    expect(linkifyUrls('Check out https://example.com.')).toEqual([
      { type: 'text', value: 'Check out ' },
      { type: 'url', value: 'https://example.com' },
      { type: 'text', value: '.' },
    ])
  })

  it.each([',', '!', '?', ';', ':'])('leaves a trailing %s out of the URL', (punctuation) => {
    expect(linkifyUrls(`see https://example.com${punctuation} next`)).toEqual([
      { type: 'text', value: 'see ' },
      { type: 'url', value: 'https://example.com' },
      { type: 'text', value: `${punctuation} next` },
    ])
  })

  it('leaves an unopened closing paren out of the URL', () => {
    expect(linkifyUrls('(see https://example.com)')).toEqual([
      { type: 'text', value: '(see ' },
      { type: 'url', value: 'https://example.com' },
      { type: 'text', value: ')' },
    ])
  })

  it('keeps a closing paren the URL itself opened', () => {
    expect(linkifyUrls('https://en.wikipedia.org/wiki/Mercury_(planet)')).toEqual([
      { type: 'url', value: 'https://en.wikipedia.org/wiki/Mercury_(planet)' },
    ])
  })

  it('keeps a trailing slash', () => {
    expect(linkifyUrls('https://example.com/path/')).toEqual([
      { type: 'url', value: 'https://example.com/path/' },
    ])
  })
})
