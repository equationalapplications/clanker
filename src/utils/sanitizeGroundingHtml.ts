import { isSafeHttpUrl } from '~/utils/isSafeHttpUrl'

const SCRIPT_TAG_RE = /<script\b[^<]*(?:(?!<\/script[^>]*>)<[^<]*)*<\/script[^>]*>/gi
const SCRIPT_SELF_CLOSING_RE = /<script\b[^>]*\/?>/gi
const INLINE_EVENT_HANDLER_RE = /\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi
const ANCHOR_TAG_RE = /<a\b([^>]*)>/gi
const IMG_TAG_RE = /<img\b([^>]*)>/gi
const HREF_ATTR_RE =
  /(?:^|\s)(?:xlink:)?href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi
const SRC_ATTR_RE = /(?:^|\s)src\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi

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

function splitSelfClosing(attrs: string): { body: string; selfClosing: boolean } {
  const trimmed = attrs.trim()
  const selfClosingMatch = trimmed.match(/^(.*?)\s*\/\s*$/)
  if (selfClosingMatch) {
    return { body: selfClosingMatch[1].trim(), selfClosing: true }
  }
  return { body: trimmed, selfClosing: false }
}

function formatTag(tagName: 'a' | 'img', attrs: string, selfClosing = false): string {
  const trimmed = attrs.trim()
  if (!trimmed) {
    return selfClosing ? `<${tagName} />` : `<${tagName}>`
  }
  return selfClosing ? `<${tagName} ${trimmed} />` : `<${tagName} ${trimmed}>`
}

function cloneRegExp(re: RegExp): RegExp {
  return new RegExp(re.source, re.flags)
}

function stripUnsafeUrlAttribute(
  tagName: 'a' | 'img',
  attrs: string,
  urlAttrRe: RegExp,
): string {
  const attrRe = cloneRegExp(urlAttrRe)
  const matches = [...attrs.matchAll(attrRe)]
  if (matches.length === 0) {
    return `<${tagName}${attrs}>`
  }

  const lastMatch = matches[matches.length - 1]
  const url = lastMatch[1] ?? lastMatch[2] ?? lastMatch[3] ?? ''
  const strippedAttrs = attrs.replace(cloneRegExp(urlAttrRe), '').replace(/\s{2,}/g, ' ').trim()
  const { body, selfClosing } = splitSelfClosing(strippedAttrs)

  if (!isSafeHttpUrl(url)) {
    return formatTag(tagName, body, selfClosing)
  }

  if (matches.length === 1) {
    return `<${tagName}${attrs}>`
  }

  const safeAttr = lastMatch[0].trim()
  const combinedBody = body ? `${body} ${safeAttr}` : safeAttr
  return formatTag(tagName, combinedBody, selfClosing)
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
