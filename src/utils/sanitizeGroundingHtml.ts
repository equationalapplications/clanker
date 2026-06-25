import { isSafeHttpUrl } from '~/utils/isSafeHttpUrl'

const SCRIPT_TAG_RE = /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi
const SCRIPT_SELF_CLOSING_RE = /<script\b[^>]*\/?>/gi
const INLINE_EVENT_HANDLER_RE = /\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi
const ANCHOR_TAG_RE = /<a\b([^>]*)>/gi
const HREF_ATTR_RE = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i

/** Remove script tags and inline event handlers from API-provided HTML snippets. */
export function stripExecutableGroundingMarkup(html: string): string {
  return html
    .replace(SCRIPT_TAG_RE, '')
    .replace(SCRIPT_SELF_CLOSING_RE, '')
    .replace(INLINE_EVENT_HANDLER_RE, '')
}

/** Strip unsafe hrefs from anchor tags (native path; web uses DOMParser). */
export function sanitizeGroundingHtmlLinksRegex(html: string): string {
  return html.replace(ANCHOR_TAG_RE, (_, attrs: string) => {
    const hrefMatch = attrs.match(HREF_ATTR_RE)
    if (!hrefMatch) {
      return `<a${attrs}>`
    }

    const href = hrefMatch[1] ?? hrefMatch[2] ?? hrefMatch[3] ?? ''
    if (!isSafeHttpUrl(href)) {
      const cleanedAttrs = attrs.replace(HREF_ATTR_RE, '').trim()
      return cleanedAttrs ? `<a ${cleanedAttrs}>` : '<a>'
    }

    return `<a${attrs}>`
  })
}

/** Defense-in-depth sanitization before rendering grounding HTML on native WebViews. */
export function sanitizeGroundingHtmlForNative(html: string): string {
  return sanitizeGroundingHtmlLinksRegex(stripExecutableGroundingMarkup(html))
}
