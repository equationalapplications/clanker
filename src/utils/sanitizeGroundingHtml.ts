import { isSafeHttpUrl } from '~/utils/isSafeHttpUrl'

const SCRIPT_TAG_RE = /<script\b[^<]*(?:(?!<\/script[^>]*>)<[^<]*)*<\/script[^>]*>/gi
const SCRIPT_SELF_CLOSING_RE = /<script\b[^>]*\/?>/gi
const INLINE_EVENT_HANDLER_RE = /\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi
const ANCHOR_TAG_RE = /<a\b([^>]*)>/gi
const IMG_TAG_RE = /<img\b([^>]*)>/gi
const HREF_ATTR_RE = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i
const SRC_ATTR_RE = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i

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
  result = replaceUntilStable(result, /<(?:link|meta|base)\b[^>]*>/gi)
  return result
}

function stripUnsafeUrlAttribute(
  tagName: 'a' | 'img',
  attrs: string,
  urlAttrRe: RegExp,
): string {
  const urlMatch = attrs.match(urlAttrRe)
  if (!urlMatch) {
    return `<${tagName}${attrs}>`
  }

  const url = urlMatch[1] ?? urlMatch[2] ?? urlMatch[3] ?? ''
  if (!isSafeHttpUrl(url)) {
    const cleanedAttrs = attrs.replace(urlAttrRe, '').trim()
    return cleanedAttrs ? `<${tagName} ${cleanedAttrs}>` : `<${tagName}>`
  }

  return `<${tagName}${attrs}>`
}

/** Strip unsafe hrefs and img src values (native path; web uses DOMParser). */
export function sanitizeGroundingHtmlLinksRegex(html: string): string {
  return html
    .replace(ANCHOR_TAG_RE, (_, attrs: string) => stripUnsafeUrlAttribute('a', attrs, HREF_ATTR_RE))
    .replace(IMG_TAG_RE, (_, attrs: string) => stripUnsafeUrlAttribute('img', attrs, SRC_ATTR_RE))
}

/** Defense-in-depth sanitization before rendering grounding HTML on native WebViews. */
export function sanitizeGroundingHtmlForNative(html: string): string {
  return sanitizeGroundingHtmlLinksRegex(stripExecutableGroundingMarkup(html))
}
