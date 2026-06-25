import { isSafeHttpUrl } from '~/utils/isSafeHttpUrl'

const SCRIPT_TAG_RE = /<script\b[^<]*(?:(?!<\/script[^>]*>)<[^<]*)*<\/script[^>]*>/gi
const SCRIPT_SELF_CLOSING_RE = /<script\b[^>]*\/?>/gi
const INLINE_EVENT_HANDLER_RE = /\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi
const ANCHOR_TAG_RE = /<a\b([^>]*)>/gi
const HREF_ATTR_RE = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i

/** Repeat replace until stable — avoids CodeQL incomplete-sanitization bypasses. */
function replaceUntilStable(html: string, pattern: RegExp): string {
  let result = html
  let previous = ''
  while (result !== previous) {
    previous = result
    result = result.replace(new RegExp(pattern.source, pattern.flags), '')
  }
  return result
}

/** Remove script tags and inline event handlers from API-provided HTML snippets. */
export function stripExecutableGroundingMarkup(html: string): string {
  let result = html
  result = replaceUntilStable(result, SCRIPT_TAG_RE)
  result = replaceUntilStable(result, SCRIPT_SELF_CLOSING_RE)
  result = replaceUntilStable(result, INLINE_EVENT_HANDLER_RE)
  result = replaceUntilStable(
    result,
    /<(?:iframe|object|embed|frame|frameset)\b[^>]*>(?:[\s\S]*?<\/(?:iframe|object|embed|frame|frameset)\s*>)?/gi,
  )
  result = replaceUntilStable(result, /<(?:link|meta)\b[^>]*>/gi)
  return result
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
