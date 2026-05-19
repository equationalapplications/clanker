/**
 * Integration tests for wiki embedding and cosine similarity ranking.
 *
 * Uses better-sqlite3 (via expoSqliteBetterSqlite3Mock) for real SQLite operations
 * so that Float32Array blobs are actually stored/retrieved and the JS cosine math
 * inside expo-llm-wiki executes against real data.
 *
 * Strategy: pre-seed facts with known orthogonal embedding vectors via importDump
 * (bypassing ingestDocument/LLM), then call wiki.read() with a query vector and
 * verify cosine ranking order.
 */

import type { SQLiteDatabase } from 'expo-sqlite'
import type { WikiFact, WikiMemory } from '@equationalapplications/expo-llm-wiki'

// Use real SQLite (better-sqlite3 in-memory) instead of the native expo-sqlite mock
jest.mock('expo-sqlite', () => {
  const { createExpoSqliteBetterSqlite3Mock } = require('./helpers/expoSqliteBetterSqlite3Mock')
  return createExpoSqliteBetterSqlite3Mock()
})

// Mock apiClient so wikiLlmProvider can be imported without Firebase native dependencies
jest.mock('~/services/apiClient', () => ({
  generateEmbedding: jest.fn(),
  wikiLlm: jest.fn(),
  wikiSync: jest.fn(),
}))

import { createWiki } from '@equationalapplications/expo-llm-wiki'
import { createWikiLlmProvider } from '~/services/wikiLlmProvider'
import { generateEmbedding } from '~/services/apiClient'

// Build a 768-dim unit vector with 1.0 at the given index
function unitVec(index: number): number[] {
  const v = new Array(768).fill(0)
  v[index] = 1.0
  return v
}

// Serialize a float32 number[] to the Uint8Array blob format expected by importDump
function toBlob(vec: number[]): Uint8Array {
  return new Uint8Array(new Float32Array(vec).buffer)
}

function makeFact(
  id: string,
  entityId: string,
  title: string,
  body: string,
  blob: Uint8Array,
): WikiFact {
  const now = Date.now()
  return {
    id,
    entity_id: entityId,
    title,
    body,
    tags: [],
    confidence: 'certain',
    source_type: 'immutable_document',
    source_hash: null,
    source_ref: null,
    created_at: now,
    updated_at: now,
    last_accessed_at: null,
    access_count: 0,
    deleted_at: null,
    embedding_blob: blob,
  }
}

describe('wiki embedding integration', () => {
  let db: SQLiteDatabase
  let wiki: WikiMemory
  let onRetrievalFallback: jest.Mock

  beforeEach(async () => {
    const { openDatabaseSync } = require('expo-sqlite')
    db = openDatabaseSync(':memory:')
    jest.clearAllMocks()

    onRetrievalFallback = jest.fn()
    wiki = createWiki(db, {
      llmProvider: createWikiLlmProvider(),
      onRetrievalFallback,
      config: {
        tablePrefix: 'test_embed_',
        hybridWeight: 1.0, // pure semantic — cosine score determines rank
      },
    })

    await wiki.setup()
  })

  afterEach(() => {
    db.closeSync()
  })

  it('ranks facts by cosine similarity to query vector', async () => {
    const ENTITY = 'rank-test'

    // Orthogonal 768-dim unit vectors: apple lives at dim 0, banana at dim 1
    const vectorApple = unitVec(0)
    const vectorBanana = unitVec(1)

    await wiki.importDump({
      generatedAt: Date.now(),
      entities: {
        [ENTITY]: {
          facts: [
            makeFact('fact-apple', ENTITY, 'Apples', 'The apple is a popular fruit with red or green skin.', toBlob(vectorApple)),
            makeFact('fact-banana', ENTITY, 'Bananas', 'Bananas are yellow and rich in potassium.', toBlob(vectorBanana)),
          ],
          tasks: [],
          events: [],
        },
      },
    })

    // Query vector is close to apple (0.9 on dim 0) and only slightly toward banana (0.1 on dim 1)
    // Cosine(query, apple) ≈ 0.994,  Cosine(query, banana) ≈ 0.110
    const queryVector = new Array(768).fill(0)
    queryVector[0] = 0.9
    queryVector[1] = 0.1

    ;(generateEmbedding as jest.Mock).mockResolvedValueOnce({
      data: { embedding: queryVector },
    })

    const bundle = await wiki.read(ENTITY, 'Tell me about red fruits')

    expect(generateEmbedding).toHaveBeenCalledTimes(1)
    expect(generateEmbedding).toHaveBeenCalledWith({
      text: 'Tell me about red fruits',
      taskType: 'RETRIEVAL_DOCUMENT',
    })

    expect(bundle.facts.length).toBeGreaterThanOrEqual(2)
    // Cosine(query, apple) ≈ 0.994 > Cosine(query, banana) ≈ 0.110 — apple must rank first
    expect(bundle.facts[0].title).toBe('Apples')
    expect(bundle.facts[1].title).toBe('Bananas')
  })

  it('falls back to keyword search when embedding fails', async () => {
    const ENTITY = 'fallback-test'

    await wiki.importDump({
      generatedAt: Date.now(),
      entities: {
        [ENTITY]: {
          facts: [
            makeFact('fact-apples', ENTITY, 'Apples', 'The apple is a popular fruit.', toBlob(unitVec(0))),
          ],
          tasks: [],
          events: [],
        },
      },
    })

    ;(generateEmbedding as jest.Mock).mockRejectedValueOnce(
      new Error('internal: Failed to generate embedding'),
    )

    const bundle = await wiki.read(ENTITY, 'Apples')

    // expo-llm-wiki falls back to keyword search — result is still an array, not a throw
    expect(Array.isArray(bundle.facts)).toBe(true)
    expect(generateEmbedding).toHaveBeenCalledTimes(1)
    // wiki signals the fallback via the onRetrievalFallback callback
    expect(onRetrievalFallback).toHaveBeenCalledTimes(1)
    expect(onRetrievalFallback.mock.calls[0][0]).toBeInstanceOf(Error)
  })
})
