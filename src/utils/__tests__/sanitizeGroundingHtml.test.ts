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
})

describe('sanitizeGroundingHtmlForNative', () => {
  it('strips executable markup and unsafe links together', () => {
    const html =
      '<a href="javascript:alert(1)" onclick="alert(2)">x</a><script>alert(3)</script>'
    expect(sanitizeGroundingHtmlForNative(html)).toBe('<a>x</a>')
  })
})
