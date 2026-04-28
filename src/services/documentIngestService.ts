import { appCheckReady, documentExtractFn } from '~/config/firebaseConfig'

export interface ExtractedFact {
  title: string
  body: string
  tags: string[]
  confidence: 'certain' | 'inferred' | 'tentative'
}

export interface DocumentExtractInput {
  characterId: string
  filename: string
  content: string
  contentHash: string
}

export interface DocumentExtractOutput {
  facts: ExtractedFact[]
  contentHash: string
  truncated: boolean
}

interface DocumentExtractCallableResponse {
  facts?: unknown
  contentHash?: unknown
  truncated?: unknown
}

function parseExtractedFact(raw: unknown): ExtractedFact | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>

  const title = typeof obj.title === 'string' ? obj.title.trim() : null
  const body = typeof obj.body === 'string' ? obj.body.trim() : null
  const confidence =
    obj.confidence === 'certain' || obj.confidence === 'inferred' || obj.confidence === 'tentative'
      ? obj.confidence
      : null

  if (!title || !body || !confidence) {
    console.warn('[documentIngestService] Dropped server fact: missing required field(s)', {
      hasTitle: Boolean(title),
      hasBody: Boolean(body),
      hasConfidence: Boolean(confidence),
    })
    return null
  }

  // Validate length constraints; should never happen if server validated properly
  if (title.length > 80) {
    console.warn('Extracted fact title exceeds 80 chars (server returned out-of-spec)', { titleLen: title.length })
    return null
  }
  if (body.length > 200) {
    console.warn('Extracted fact body exceeds 200 chars (server returned out-of-spec)', { bodyLen: body.length })
    return null
  }

  const rawTags = Array.isArray(obj.tags) ? obj.tags : []
  const tags = rawTags
    .filter((t): t is string => typeof t === 'string')
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0 && t.length <= 40)
    .slice(0, 6)

  if (rawTags.length > tags.length) {
    console.warn('Extracted fact tags were filtered (server returned invalid tags)', { 
      originalCount: rawTags.length,
      filteredCount: tags.length,
    })
  }

  return { title, body, tags, confidence }
}

export async function extractDocument(input: DocumentExtractInput): Promise<DocumentExtractOutput> {
  await appCheckReady

  const result = await documentExtractFn({
    characterId: input.characterId,
    filename: input.filename,
    content: input.content,
    contentHash: input.contentHash,
  })

  const data = result.data as DocumentExtractCallableResponse

  const rawFacts = Array.isArray(data?.facts) ? data.facts : []
  const facts = rawFacts
    .map(parseExtractedFact)
    .filter((f): f is ExtractedFact => f !== null)

  const contentHash =
    typeof data?.contentHash === 'string' && /^[0-9a-f]{64}$/i.test(data.contentHash)
      ? data.contentHash
      : input.contentHash

  const truncated = data?.truncated === true

  return { facts, contentHash, truncated }
}
