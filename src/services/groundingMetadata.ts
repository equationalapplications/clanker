import type { GroundingMetadata } from '@google/genai'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === '[object Object]'
}

/**
 * Normalize the grounding metadata returned by Gemini (via the generateReply
 * callable or the cloud agent) into the subset we render. Returns undefined when
 * nothing usable is present so callers can skip the citation view entirely.
 *
 * Google Search grounding Terms of Use require displaying searchEntryPoint
 * (the rendered "Search Suggestions" HTML) and the source citations to the user.
 */
export function parseGroundingMetadata(raw: unknown): GroundingMetadata | undefined {
  if (!isPlainObject(raw)) {
    return undefined
  }

  const metadata: GroundingMetadata = {}

  if (Array.isArray(raw.webSearchQueries) && raw.webSearchQueries.every((q) => typeof q === 'string')) {
    metadata.webSearchQueries = raw.webSearchQueries as string[]
  }

  if (Array.isArray(raw.groundingChunks)) {
    const chunks = raw.groundingChunks.filter(isPlainObject)
    if (chunks.length > 0) {
      metadata.groundingChunks = chunks as GroundingMetadata['groundingChunks']
    }
  }

  if (Array.isArray(raw.groundingSupports)) {
    const supports = raw.groundingSupports.filter(isPlainObject)
    if (supports.length > 0) {
      metadata.groundingSupports = supports as GroundingMetadata['groundingSupports']
    }
  }

  if (
    isPlainObject(raw.searchEntryPoint) &&
    typeof raw.searchEntryPoint.renderedContent === 'string'
  ) {
    metadata.searchEntryPoint = raw.searchEntryPoint as GroundingMetadata['searchEntryPoint']
  }

  return Object.keys(metadata).length > 0 ? metadata : undefined
}
