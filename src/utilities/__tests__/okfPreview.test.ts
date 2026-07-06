import { detectOkfProfile, markdownToPlainSnippet } from '../okfPreview'
import { loadOkfFixture } from './okfFixtures'

describe('detectOkfProfile', () => {
  it('detects llm-wiki/1 on the golden fixture', () => {
    expect(detectOkfProfile(loadOkfFixture('golden-v1'))).toBe('llm-wiki/1')
  })

  it('reports legacy for profile-0 fixture', () => {
    expect(detectOkfProfile(loadOkfFixture('legacy-profile-0'))).toBe('legacy')
  })

  it('reports legacy when the root index is missing', () => {
    expect(detectOkfProfile([])).toBe('legacy')
  })
})

describe('markdownToPlainSnippet', () => {
  it('strips markdown syntax so a slice cannot break rendering', () => {
    const md = '# Title\n\nThis is **bold**, a [link](https://x.example), `code`, and _emphasis_.\n\n- item one\n- item two'
    const snippet = markdownToPlainSnippet(md)
    expect(snippet).toBe('Title This is bold, a link, code, and emphasis. item one item two')
    expect(snippet).not.toMatch(/[*_[\]#`]/)
  })

  it('caps length on the stripped plain text with an ellipsis', () => {
    const snippet = markdownToPlainSnippet('word '.repeat(100), 20)
    expect(snippet.length).toBeLessThanOrEqual(21) // 20 + ellipsis
    expect(snippet.endsWith('…')).toBe(true)
  })

  it('drops orphaned markdown syntax that survives the paired-delimiter passes', () => {
    expect(markdownToPlainSnippet('Hello *world unclosed')).not.toMatch(/[*_`[\]]/)
    expect(markdownToPlainSnippet('Check this [broken link text without closing')).not.toMatch(
      /[*_`[\]]/,
    )
    expect(markdownToPlainSnippet('```code without a closing fence')).not.toMatch(/[*_`[\]]/)
  })
})
