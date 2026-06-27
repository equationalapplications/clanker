import { parseGroundingMetadata } from '~/services/groundingMetadata'

describe('parseGroundingMetadata', () => {
  it('preserves searchEntryPoint.renderedContent verbatim for Google widget HTML', () => {
    const googleHtml =
      '<style>.gs-chip{color:#1a73e8;font-family:Roboto}</style>' +
      '<div class="gs-chip" role="listitem">Weather today</div>'

    const parsed = parseGroundingMetadata({
      searchEntryPoint: { renderedContent: googleHtml },
    })

    expect(parsed?.searchEntryPoint?.renderedContent).toBe(googleHtml)
  })

  it('returns undefined when renderedContent is missing and no other grounding fields exist', () => {
    expect(parseGroundingMetadata({ searchEntryPoint: {} })).toBeUndefined()
    expect(parseGroundingMetadata({})).toBeUndefined()
    expect(parseGroundingMetadata(null)).toBeUndefined()
  })

  it('parses groundingChunks alongside renderedContent without altering HTML', () => {
    const googleHtml = '<div>Suggestions</div>'
    const parsed = parseGroundingMetadata({
      groundingChunks: [{ web: { uri: 'https://example.com', title: 'Example' } }],
      searchEntryPoint: { renderedContent: googleHtml },
    })

    expect(parsed?.searchEntryPoint?.renderedContent).toBe(googleHtml)
    expect(parsed?.groundingChunks).toEqual([
      { web: { uri: 'https://example.com', title: 'Example' } },
    ])
  })
})
