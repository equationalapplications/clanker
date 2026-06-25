import {
  sanitizeGroundingHtmlForNative,
  sanitizeGroundingHtmlLinksRegex,
  stripExecutableGroundingMarkup,
} from '../sanitizeGroundingHtml'

describe('stripExecutableGroundingMarkup', () => {
  it('removes script tags and their contents', () => {
    const html = '<div>ok</div><script>alert(1)</script><span>more</span>'
    expect(stripExecutableGroundingMarkup(html)).toBe('<div>ok</div><span>more</span>')
  })

  it('removes inline event handlers', () => {
    const html = '<button onclick="alert(1)">tap</button>'
    expect(stripExecutableGroundingMarkup(html)).toBe('<button>tap</button>')
  })

  it('removes script tags with whitespace before the closing angle bracket', () => {
    const html = '<div>ok</div><script>alert(1)</script ><span>more</span>'
    expect(stripExecutableGroundingMarkup(html)).toBe('<div>ok</div><span>more</span>')
  })

  it('removes script tags with junk between the tag name and closing angle bracket', () => {
    const html = '<div>ok</div><script>alert(1)</script\t\n bar><span>more</span>'
    expect(stripExecutableGroundingMarkup(html)).toBe('<div>ok</div><span>more</span>')
  })

  it('removes nested script tag obfuscation', () => {
    const html = '<scr<script>ipt>alert(1)</scr</script>ipt>'
    expect(stripExecutableGroundingMarkup(html)).toBe('')
  })

  it('removes embed-capable elements', () => {
    const html =
      '<iframe src="https://evil.example"></iframe><object data="x"></object><embed src="x"><div>ok</div>'
    expect(stripExecutableGroundingMarkup(html)).toBe('<div>ok</div>')
  })

  it('removes resource-loading head tags', () => {
    const html =
      '<link rel="stylesheet" href="https://evil.example/style.css"><meta http-equiv="refresh" content="0"><base href="https://evil.example/"><div>ok</div>'
    expect(stripExecutableGroundingMarkup(html)).toBe('<div>ok</div>')
  })
})

describe('sanitizeGroundingHtmlLinksRegex', () => {
  it('removes unsafe hrefs', () => {
    const html = '<a href="javascript:alert(1)">bad</a>'
    expect(sanitizeGroundingHtmlLinksRegex(html)).toBe('<a>bad</a>')
  })

  it('keeps safe http(s) hrefs', () => {
    const html = '<a href="https://example.com">good</a>'
    expect(sanitizeGroundingHtmlLinksRegex(html)).toBe('<a href="https://example.com">good</a>')
  })

  it('removes unsafe img src values', () => {
    const html = '<img alt="track" src="javascript:alert(1)">'
    expect(sanitizeGroundingHtmlLinksRegex(html)).toBe('<img alt="track">')
  })

  it('keeps safe http(s) img src values', () => {
    const html = '<img alt="icon" src="https://example.com/icon.png">'
    expect(sanitizeGroundingHtmlLinksRegex(html)).toBe(
      '<img alt="icon" src="https://example.com/icon.png">',
    )
  })
})

describe('sanitizeGroundingHtmlForNative', () => {
  it('strips executable markup and unsafe links together', () => {
    const html =
      '<a href="javascript:alert(1)" onclick="alert(2)">x</a><script>alert(3)</script>'
    expect(sanitizeGroundingHtmlForNative(html)).toBe('<a>x</a>')
  })

  it('removes embed-capable elements and external stylesheet links', () => {
    const html =
      '<link rel="stylesheet" href="https://evil.example/style.css"><iframe src="https://evil.example"></iframe><div class="row">Suggestion</div>'
    expect(sanitizeGroundingHtmlForNative(html)).toBe('<div class="row">Suggestion</div>')
  })

  it('strips base tags and unsafe img src while preserving safe markup', () => {
    const html =
      '<base href="https://evil.example/"><img src="javascript:alert(1)" alt="x"><img src="https://cdn.example/icon.png" alt="icon"><a href="https://example.com">go</a>'
    expect(sanitizeGroundingHtmlForNative(html)).toBe(
      '<img alt="x"><img src="https://cdn.example/icon.png" alt="icon"><a href="https://example.com">go</a>',
    )
  })
})
