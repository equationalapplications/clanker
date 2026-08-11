// Matches http/https URLs. Emails and phone numbers are intentionally NOT matched
// — gifted-chat did not match them either, and adding matchers now would change
// user-visible behavior. Add a new spec if you want them.
const URL_PATTERN = /https?:\/\/[^\s<>"']+/g

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
    segments.push({ type: 'url', value: match[0] })
    lastIndex = start + match[0].length
  }
  if (lastIndex < text.length) {
    segments.push({ type: 'text', value: text.slice(lastIndex) })
  }
  return segments
}