import { createMachine, assign, fromPromise, type ActorRefFrom } from 'xstate'
import { createActor } from 'xstate'
import * as DocumentPicker from 'expo-document-picker'
import * as FileSystem from 'expo-file-system'
import * as Crypto from 'expo-crypto'
import { Platform } from 'react-native'
import { findEntriesByHash, bulkInsertEntries, type WikiEntryUpsertInput } from '~/database/wikiDatabase'
import { appendMemoryEvents, type MemoryEventUpsertInput } from '~/database/memoryEventDatabase'
import { forgetMemory } from '~/services/memoryService'
import { extractDocument, type ExtractedFact } from '~/services/documentIngestService'
import { queryClient } from '~/config/queryClient'
import { INGEST_STATE_PROGRESS } from '~/constants/documentIngestProgress'
import type { Character } from '~/services/aiChatService'

// ─── Context + Events ─────────────────────────────────────────────────────────
export interface DocumentIngestContext {
  characterId: string
  userId: string
  filename: string | null
  fileUri: string | null
  contentHash: string | null
  content: string | null
  facts: ExtractedFact[]
  duplicateEntryCount: number
  progress: number
  errorMessage: string | null
}

export type DocumentIngestEvent =
  | { type: 'INGEST'; characterId: string; userId: string }
  | { type: 'REPLACE' }
  | { type: 'ADD' }
  | { type: 'CANCEL' }

// ─── Actor inputs ─────────────────────────────────────────────────────────────
interface CheckDupInput { characterId: string; contentHash: string }
interface PurgeInput { character: Pick<Character, 'id' | 'cloud_id'>; userId: string; contentHash: string }
interface ExtractInput { characterId: string; filename: string; content: string; contentHash: string }
interface ApplyInput { characterId: string; userId: string; filename: string; contentHash: string; facts: ExtractedFact[] }

// ─── Unique ID helper ─────────────────────────────────────────────────────────
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

// ─── Normalize text (mirror server normalization) ─────────────────────────────
function normalizeContent(raw: string): string {
  return raw.replace(/^\uFEFF/, '').replace(/\u0000/g, '').normalize('NFC')
}

// ─── Machine definition ───────────────────────────────────────────────────────
export const documentIngestMachine = createMachine(
  {
    id: 'documentIngest',
    types: {} as {
      context: DocumentIngestContext
      events: DocumentIngestEvent
      input: { characterId: string; userId: string }
    },
    initial: 'idle',
    context: ({ input }) => ({
      characterId: input.characterId,
      userId: input.userId,
      filename: null,
      fileUri: null,
      contentHash: null,
      content: null,
      facts: [],
      duplicateEntryCount: 0,
      progress: 0,
      errorMessage: null,
    }),
    states: {
      idle: {
        on: {
          INGEST: {
            target: 'picking',
            actions: assign({
              characterId: ({ event }) => event.characterId,
              userId: ({ event }) => event.userId,
              filename: null,
              fileUri: null,
              contentHash: null,
              content: null,
              facts: [],
              duplicateEntryCount: 0,
              errorMessage: null,
              progress: 0,
            }),
          },
        },
      },

      picking: {
        entry: assign({ progress: INGEST_STATE_PROGRESS.picking }),
        invoke: {
          id: 'pickDocument',
          src: 'pickDocument',
          onDone: [
            {
              guard: ({ event }) => event.output === null,
              target: 'idle',
            },
            {
              target: 'reading',
              actions: assign({
                filename: ({ event }) => (event.output as { filename: string; uri: string }).filename,
                fileUri: ({ event }) => (event.output as { filename: string; uri: string }).uri,
              }),
            },
          ],
          onError: {
            target: 'error',
            actions: assign({
              errorMessage: ({ event }) =>
                event.error instanceof Error ? event.error.message : 'Failed to pick document.',
            }),
          },
        },
      },

      reading: {
        entry: assign({ progress: INGEST_STATE_PROGRESS.reading }),
        invoke: {
          id: 'readDocument',
          src: 'readDocument',
          input: ({ context }) => ({ fileUri: context.fileUri }),
          onDone: {
            target: 'checkingDuplicate',
            actions: assign({
              content: ({ event }) => (event.output as { content: string; contentHash: string }).content,
              contentHash: ({ event }) => (event.output as { content: string; contentHash: string }).contentHash,
            }),
          },
          onError: {
            target: 'error',
            actions: assign({
              errorMessage: ({ event }) =>
                event.error instanceof Error ? event.error.message : 'Failed to read document.',
            }),
          },
        },
        on: {
          CANCEL: 'idle',
        },
      },

      checkingDuplicate: {
        entry: assign({ progress: INGEST_STATE_PROGRESS.checkingDuplicate }),
        invoke: {
          id: 'checkDuplicate',
          src: 'checkDuplicate',
          input: ({ context }): CheckDupInput => ({
            characterId: context.characterId,
            contentHash: context.contentHash ?? '',
          }),
          onDone: [
            {
              guard: ({ event }) => (event.output as number) > 0,
              target: 'confirmingDuplicate',
              actions: assign({
                duplicateEntryCount: ({ event }) => event.output as number,
              }),
            },
            {
              target: 'extracting',
            },
          ],
          onError: {
            // Non-blocking: if dedup check fails, proceed anyway
            target: 'extracting',
          },
        },
        on: {
          CANCEL: 'idle',
        },
      },

      confirmingDuplicate: {
        entry: assign({ progress: INGEST_STATE_PROGRESS.confirmingDuplicate }),
        on: {
          REPLACE: 'purging',
          ADD: 'extracting',
          CANCEL: 'idle',
        },
      },

      purging: {
        entry: assign({ progress: INGEST_STATE_PROGRESS.purging }),
        invoke: {
          id: 'purgeDocument',
          src: 'purgeDocument',
          input: ({ context }): PurgeInput => ({
            character: {
              id: context.characterId,
              cloud_id: null,
            },
            userId: context.userId,
            contentHash: context.contentHash ?? '',
          }),
          onDone: 'extracting',
          onError: {
            target: 'error',
            actions: assign({
              errorMessage: ({ event }) =>
                event.error instanceof Error ? event.error.message : 'Failed to purge prior document entries.',
            }),
          },
        },
      },

      extracting: {
        entry: assign({ progress: INGEST_STATE_PROGRESS.extracting }),
        invoke: {
          id: 'extractDocument',
          src: 'extractDocumentActor',
          input: ({ context }): ExtractInput => ({
            characterId: context.characterId,
            filename: context.filename ?? '',
            content: context.content ?? '',
            contentHash: context.contentHash ?? '',
          }),
          onDone: {
            target: 'applying',
            actions: assign({
              facts: ({ event }) => event.output as ExtractedFact[],
              content: null,
            }),
          },
          onError: {
            target: 'error',
            actions: assign({
              errorMessage: ({ event }) =>
                event.error instanceof Error ? event.error.message : 'Failed to extract document facts.',
            }),
          },
        },
        on: {
          CANCEL: {
            target: 'idle',
            actions: assign({ content: null }),
          },
        },
      },

      applying: {
        entry: assign({ progress: INGEST_STATE_PROGRESS.applying }),
        invoke: {
          id: 'applyFacts',
          src: 'applyFacts',
          input: ({ context }): ApplyInput => ({
            characterId: context.characterId,
            userId: context.userId,
            filename: context.filename ?? '',
            contentHash: context.contentHash ?? '',
            facts: context.facts,
          }),
          onDone: 'success',
          onError: {
            target: 'error',
            actions: assign({
              errorMessage: ({ event }) =>
                event.error instanceof Error ? event.error.message : 'Failed to save facts to memory.',
            }),
          },
        },
      },

      success: {
        entry: [
          assign({ progress: INGEST_STATE_PROGRESS.success }),
          ({ context }) => {
            queryClient.invalidateQueries({ queryKey: ['memoryBundle', context.characterId] })
          },
        ],
        after: {
          0: 'idle',
        },
      },

      error: {
        entry: assign({ progress: 0 }),
        after: {
          0: 'idle',
        },
      },
    },
  },
  {
    actors: {
      pickDocument: fromPromise(async (): Promise<{ filename: string; uri: string } | null> => {
        const result = await DocumentPicker.getDocumentAsync({
          type: ['text/plain', 'text/markdown'],
          copyToCacheDirectory: true,
          multiple: false,
        })
        if (result.canceled) return null
        const asset = result.assets[0]
        if (!asset) return null
        const sanitized = asset.name
          .replace(/[/\\]/g, '')
          .replace(/\u0000/g, '')
           
          .replace(/[\x00-\x1f\x7f]/g, '')
          .trim()
          .slice(0, 255)
        return { filename: sanitized || 'document.txt', uri: asset.uri }
      }),

      readDocument: fromPromise(
        async ({ input }: { input: { fileUri: string | null } }): Promise<{ content: string; contentHash: string }> => {
          if (!input.fileUri) throw new Error('No file URI available.')
          let raw: string
          if (Platform.OS === 'web') {
            // expo-file-system does not support web; blob URIs from the document
            // picker are readable via fetch on web.
            const response = await fetch(input.fileUri)
            raw = await response.text()
          } else {
            raw = await FileSystem.readAsStringAsync(input.fileUri, {
              encoding: 'utf8',
            })
          }
          const content = normalizeContent(raw)
          if (!content.trim()) throw new Error('Document is empty.')
          const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, content)
          return { content, contentHash: digest }
        },
      ),

      checkDuplicate: fromPromise(async ({ input }: { input: CheckDupInput }): Promise<number> => {
        const entries = await findEntriesByHash(input.characterId, input.contentHash)
        return entries.filter((e) => e.deleted_at === null).length
      }),

      purgeDocument: fromPromise(async ({ input }: { input: PurgeInput }): Promise<void> => {
        await forgetMemory(input.character, input.userId, { sourceHash: input.contentHash })
      }),

      extractDocumentActor: fromPromise(async ({ input }: { input: ExtractInput }): Promise<ExtractedFact[]> => {
        const result = await extractDocument(input)
        return result.facts
      }),

      applyFacts: fromPromise(async ({ input }: { input: ApplyInput }): Promise<void> => {
        const now = Date.now()
        const entries: WikiEntryUpsertInput[] = input.facts.map((fact) => ({
          id: generateId(),
          characterId: input.characterId,
          userId: input.userId,
          title: fact.title,
          body: fact.body,
          tags: fact.tags,
          confidence: fact.confidence,
          sourceType: 'user_document',
          sourceHash: input.contentHash,
          sourceRef: input.filename,
          createdAt: now,
          updatedAt: now,
          lastAccessedAt: null,
          accessCount: 0,
          syncedToCloud: 0,
          cloudId: null,
          deletedAt: null,
        }))
        await bulkInsertEntries(entries)

        const event: MemoryEventUpsertInput = {
          id: generateId(),
          characterId: input.characterId,
          userId: input.userId,
          eventType: 'action',
          summary: `Ingested document ${input.filename} (${input.facts.length} facts)`,
          sourceRef: input.filename,
          createdAt: now,
          syncedToCloud: 0,
          cloudId: null,
        }
        await appendMemoryEvents([event])
      }),
    },
  },
)

export type DocumentIngestMachineActor = ActorRefFrom<typeof documentIngestMachine>

// ─── Actor registry (dedup: one actor per characterId) ────────────────────────
const activeIngestJobs = new Map<string, DocumentIngestMachineActor>()

/**
 * Returns the active actor for `characterId`, or undefined if none is running.
 */
export function getDocumentIngestMachineActor(characterId: string): DocumentIngestMachineActor | undefined {
  return activeIngestJobs.get(characterId)
}

/**
 * Dispatches an INGEST event to the machine for `characterId`.
 * If a job is already running (machine not in idle state), this is a no-op.
 * Creates and starts a new actor if none exists.
 */
export function dispatchDocumentIngest(characterId: string, userId: string): void {
  let actor = activeIngestJobs.get(characterId)

  if (!actor) {
    actor = createActor(documentIngestMachine, {
      input: { characterId, userId },
    })
    activeIngestJobs.set(characterId, actor)

    actor.subscribe((state) => {
      if (state.matches('idle') || state.status === 'done') {
        // Keep actor in map for UI access (progress bar reads from it)
      }
    })

    actor.start()
  } else {
    const snapshot = actor.getSnapshot()
    if (!snapshot.matches('idle')) {
      // No-op: ingest already in progress for this character
      return
    }
  }

  actor.send({ type: 'INGEST', characterId, userId })
}
