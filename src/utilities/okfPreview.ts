import type { OkfFile } from '~/utilities/okfImport'

export type OkfProfile = 'llm-wiki/1' | 'legacy'

/** Display-only profile detection from the root index frontmatter (no behavior branches on it). */
export function detectOkfProfile(files: readonly OkfFile[]): OkfProfile {
  const root = files.find((f) => f.path === 'index.md')
  if (!root) return 'legacy'
  return /^profile:\s*["']?llm-wiki\/1["']?\s*$/m.test(root.content) ? 'llm-wiki/1' : 'legacy'
}

/**
 * Markdown → plain-text snippet. A naive slice of raw markdown can cut a
 * token in half (unclosed **, dangling [) and break rendering; strip first,
 * cap after. Regex pass, not a markdown library — preview-quality is enough.
 */
export function markdownToPlainSnippet(markdown: string, maxChars = 200): string {
  const plain = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/(\*\*|__|~~)/g, '')
    .replace(/(^|\s)[*_](\S(?:[^*_]*\S)?)[*_](?=\s|[.,!?;:]|$)/g, '$1$2')
    .replace(/^\s*[-*+]\s+/gm, '')
    // Anything left at this point is orphaned markdown syntax from malformed
    // input (unclosed **, dangling [, an unclosed code fence's stray `) that
    // the paired-delimiter passes above couldn't match — drop it outright.
    .replace(/[*_`[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (plain.length <= maxChars) return plain
  return `${plain.slice(0, maxChars).trimEnd()}…`
}
