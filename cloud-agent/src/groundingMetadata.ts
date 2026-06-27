import type { GroundingMetadata } from '@google/genai'

/** True when Gemini returned citation/search data we must surface per Google Search ToS. */
export function hasGroundingData(metadata: GroundingMetadata | undefined): metadata is GroundingMetadata {
  return !!metadata && (
    (Array.isArray(metadata.webSearchQueries) && metadata.webSearchQueries.length > 0) ||
    (Array.isArray(metadata.groundingChunks) && metadata.groundingChunks.length > 0) ||
    (Array.isArray(metadata.groundingSupports) && metadata.groundingSupports.length > 0) ||
    typeof metadata.searchEntryPoint?.renderedContent === 'string'
  )
}
