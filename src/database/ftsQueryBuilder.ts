import { getDerivedSynonyms } from '~/database/derivedSynonymDatabase'
import { SYNONYM_MAP_BASE } from '~/database/synonymMapBase'

const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'but',
  'by',
  'for',
  'from',
  'how',
  'i',
  'if',
  'in',
  'into',
  'is',
  'it',
  'of',
  'on',
  'or',
  'so',
  'that',
  'the',
  'their',
  'there',
  'these',
  'they',
  'this',
  'to',
  'was',
  'we',
  'were',
  'what',
  'when',
  'where',
  'which',
  'who',
  'why',
  'with',
  'you',
  'your',
])

type CompromiseNlp = (text: string) => {
    nouns: () => { toSingular: () => { out: (format: 'array') => string[] } }
    verbs: () => { toInfinitive: () => { out: (format: 'array') => string[] } }
    adjectives: () => { out: (format: 'array') => string[] }
}

let compromiseLoader: Promise<CompromiseNlp> | null = null

function sanitizeToken(token: string): string {
  return token.toLowerCase().replace(/[^a-z0-9]/g, '').trim()
}

function sanitizeText(rawMessage: string): string[] {
  return rawMessage
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map(sanitizeToken)
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token))
    .slice(0, 15)
}

function normalizeInflection(token: string): string {
  if (token.endsWith('ies') && token.length > 4) {
    return `${token.slice(0, -3)}y`
  }

  if (token.endsWith('ing') && token.length > 5) {
    const stem = token.slice(0, -3)
    const hasDoubledFinalChar = stem.length >= 2 && stem.slice(-1) === stem.slice(-2, -1)
    return hasDoubledFinalChar ? stem.slice(0, -1) : stem
  }

  if (token.endsWith('es') && token.length > 4) {
    return token.slice(0, -2)
  }

  if (token.endsWith('s') && token.length > 3) {
    return token.slice(0, -1)
  }

  return token
}

async function loadCompromise() {
  if (!compromiseLoader) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('compromise') as { default?: CompromiseNlp } | CompromiseNlp
      const nlp = (typeof mod === 'function' ? mod : (mod as { default?: CompromiseNlp }).default) as CompromiseNlp
      if (typeof nlp !== 'function') {
        throw new Error('compromise module not available')
      }
      compromiseLoader = Promise.resolve(nlp)
    } catch {
      // Fallback: use simple sanitization without NLP
      compromiseLoader = Promise.resolve(((text: string) => ({
        nouns: () => ({ toSingular: () => ({ out: () => [] }) }),
        verbs: () => ({ toInfinitive: () => ({ out: () => [] }) }),
        adjectives: () => ({ out: () => [] }),
      })) as CompromiseNlp)
    }
  }

  return compromiseLoader
}

async function extractNormalizedTerms(rawMessage: string): Promise<string[]> {
  const trimmed = rawMessage.trim()
  if (!trimmed) {
    return []
  }

  const compromiseNlp = await loadCompromise()
  const doc = compromiseNlp(trimmed)
  return [...doc.nouns().toSingular().out('array'), ...doc.verbs().toInfinitive().out('array'), ...doc.adjectives().out('array')]
    .flatMap((value) => value.split(/\s+/))
    .map(sanitizeToken)
    .map(normalizeInflection)
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token))
}

function isCoveredByNormalizedToken(token: string, normalizedTokens: string[]): boolean {
  return normalizedTokens.some(
    (normalized) => normalized === token || (token.startsWith(normalized) && token.length > normalized.length),
  )
}

function mergeCoreTokens(sanitizedTokens: string[], normalizedTokens: string[]): string[] {
  const merged: string[] = []
  const seen = new Set<string>()

  for (const token of normalizedTokens) {
    if (seen.has(token)) {
      continue
    }

    seen.add(token)
    merged.push(token)
  }

  for (const token of sanitizedTokens) {
    if (seen.has(token) || isCoveredByNormalizedToken(token, normalizedTokens)) {
      continue
    }

    seen.add(token)
    merged.push(token)
  }

  return merged.slice(0, 20)
}

function buildSynonymMap(rows: { term: string; synonyms: string[] }[]): Map<string, string[]> {
  const map = new Map<string, string[]>()

  for (const [term, synonyms] of Object.entries(SYNONYM_MAP_BASE)) {
    const sanitizedSynonyms = synonyms.flatMap((s) => s.split(/\s+/).map(sanitizeToken).filter(Boolean))
    map.set(term, sanitizedSynonyms)
  }

  for (const row of rows) {
    const term = sanitizeToken(row.term)
    if (!term) {
      continue
    }

    const existing = map.get(term) ?? []
    map.set(term, [...existing, ...row.synonyms.map(sanitizeToken).filter(Boolean)])
  }

  return map
}

function expandTokens(coreTokens: string[], synonymMap: Map<string, string[]>): string[] {
  const expanded: string[] = []
  const seen = new Set<string>()

  for (const token of coreTokens) {
    if (!seen.has(token)) {
      expanded.push(token)
      seen.add(token)
    }

    const synonyms = synonymMap.get(token) ?? []
    for (const synonym of synonyms) {
      if (!synonym || seen.has(synonym)) {
        continue
      }

      expanded.push(synonym)
      seen.add(synonym)
    }
  }

  return expanded.slice(0, 20)
}

function toFtsQuery(tokens: string[]): string | null {
  if (tokens.length === 0) {
    return null
  }

  return tokens.map((token) => `"${token.replace(/"/g, '""')}"*`).join(' OR ')
}

export async function buildFtsQuery(rawMessage: string, characterId: string): Promise<string | null> {
  const sanitizedTokens = sanitizeText(rawMessage)
  if (sanitizedTokens.length === 0) {
    return null
  }

  const [normalizedTokens, derivedSynonyms] = await Promise.all([
    extractNormalizedTerms(rawMessage),
    getDerivedSynonyms(characterId),
  ])

  const coreTokens = mergeCoreTokens(sanitizedTokens, normalizedTokens)
  if (coreTokens.length === 0) {
    return null
  }

  const synonymMap = buildSynonymMap(derivedSynonyms)
  return toFtsQuery(expandTokens(coreTokens, synonymMap))
}