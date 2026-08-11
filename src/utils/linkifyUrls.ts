// Matches http/https URLs. Emails and phone numbers are intentionally NOT matched
// — gifted-chat did not match them either, and adding matchers now would change
// user-visible behavior. Add a new spec if you want them.
const URL_PATTERN = /https?:\/\/[^\s<>"']+/g

// Sentence punctuation that follows a URL far more often than it belongs to one
// ("see https://example.com."). Left attached, `Linking.openURL` gets a URL the
// OS rejects, so strip it back into the surrounding text segment.
const TRAILING_PUNCTUATION = /[.,!?;:'"]+$/

function trimTrailingPunctuation(url: string): string {
  let trimmed = url.replace(TRAILING_PUNCTUATION, '')
  // Closing brackets are only stripped when the URL never opened them, so
  // Wikipedia-style links (…/Foo_(disambiguation)) survive intact.
  for (;;) {
    const last = trimmed.at(-1)
    const opener = last === ')' ? '(' : last === ']' ? '[' : null
    if (!opener || !last) break
    const opens = trimmed.split(opener).length - 1
    const closes = trimmed.split(last).length - 1
    if (closes <= opens) break
    trimmed = trimmed.slice(0, -1).replace(TRAILING_PUNCTUATION, '')
  }
  return trimmed
}

export type LinkSegment =
  | { type: 'text'; value: string }
  | { type: 'url'; value: string }

export function linkifyUrls(text: string): LinkSegment[] {
  if (!text) return []
  const segments: LinkSegment[] = []
  let lastIndex = 0
  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0
    if (start > lastIndex) {
      segments.push({ type: 'text', value: text.slice(lastIndex, start) })
    }
    const url = trimTrailingPunctuation(match[0])
    segments.push({ type: 'url', value: url })
    lastIndex = start + url.length
  }
  if (lastIndex < text.length) {
    segments.push({ type: 'text', value: text.slice(lastIndex) })
  }
  return segments
}