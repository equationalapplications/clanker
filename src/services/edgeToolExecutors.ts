import { readFromWiki, writeToWiki } from './wikiService'
import type { Wiki } from './wikiService'
import {
  createTask,
  listTasks,
  updateTask,
  completeTask,
  deleteTask,
} from '~/database/taskDatabase'
import type { LocalTask } from '~/database/taskDatabase'
import { formatGraphContext } from '@equationalapplications/core-llm-wiki'
import { generateImageViaCallable } from './imageGenerationService'
import type { ScheduleWakeupRequest, ScheduleWakeupResponse } from './proactiveWakeupService'
import { saveCharacterImage } from './characterImageService'
import { generateSecureUuid } from '~/utilities/generateSecureUuid'
import { MASTER_DIMENSION } from './imageVariants'
import * as Crypto from 'expo-crypto'

export type ToolExecutor = (args: Record<string, unknown>) => unknown | Promise<unknown>

/**
 * Canonical string for a set_reminder operation. Both the edge executor and
 * the cloud-agent's escalated set_reminder produce identical bytes here, so the
 * opId they hash agrees across the two paths. `remindAt` is the raw ISO string
 * from the model — NOT a parsed Date — because Date#toISOString normalises the
 * offset to "Z" while the edge input may carry "+02:00", and the two would hash
 * to different bytes for the same wall-clock moment.
 *
 * Mirrored in cloud-agent/src/tools/reminders.ts (kept identical by hand; the
 * two packages do not share code).
 */
export function reminderOpIdCanonical(args: {
  characterId: string
  reason: string
  remindAt: string
  priority?: number
}): string {
  return `${args.characterId}|${args.reason.trim()}|${args.remindAt}|${args.priority ?? 0}`
}

/**
 * Deterministic operation id: same (character, reason, remindAt, priority) →
 * same opId, so a network retry lands on the same server row (the callable's
 * ON CONFLICT DO NOTHING) instead of inserting a duplicate the sweep would
 * double-fire. SHA-256 over the canonical string — 256 bits of entropy, well
 * above the FNV-1a 32-bit budget that collided on a real test corpus. Uses
 * expo-crypto so it is Hermes-safe in the React Native runtime.
 */
export async function deriveOpId(args: {
  characterId: string
  reason: string
  remindAt: string
  priority?: number
}): Promise<string> {
  const hex = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    reminderOpIdCanonical(args),
  )
  return `op-${hex}`
}

/**
 * Deps for the local `generate_image` executor, supplied only for characters
 * that cannot escalate (see isLocallyExecutableCloudTool). Cloud-synced
 * characters route the same tool call to cloud-agent instead, which owns its
 * own spend/refund ledger.
 */
export interface EdgeImageToolDeps {
  userId: string
  /** Pre-minted id of the assistant message this turn will write. */
  messageId: string
  /** Reports the saved row id so the turn can persist it as the render hint. */
  onImageSaved: (imageId: string) => void
}

/**
 * Deps for the local `set_reminder` executor, supplied for cloud-synced
 * characters via the useEdgeAgent `cloudAgentCharacterId` option. The
 * characterId is the CLOUD UUID (Postgres `characters.id`) — the callable
 * verifies ownership against characters.user_id, so the edge executor must
 * never let the model name its own target.
 */
export interface EdgeReminderToolDeps {
  characterId: string
  scheduleWakeup: (request: ScheduleWakeupRequest) => Promise<ScheduleWakeupResponse>
}

export const edgeToolExecutors: Record<string, ToolExecutor> = {
  get_current_time: () =>
    new Date().toLocaleString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    }),
}

export function createEdgeToolExecutors(
  characterId: string,
  wiki: Wiki | null,
  image?: EdgeImageToolDeps,
  reminder?: EdgeReminderToolDeps,
): Record<string, ToolExecutor> {
  // Run-scoped cap, mirroring cloud-agent's generate_image tool: the model gets
  // up to MAX_ITERATIONS turns of the loop, and without this a second call would
  // silently spend another 200 credits on the same reply.
  //
  // Two flags, because useEdgeAgent dispatches a response's function calls with
  // Promise.all: `inFlight` is the synchronous reservation that stops a second
  // concurrent call from racing past the cap before the first has awaited
  // anything, and `generatedThisTurn` is the durable one, consumed the moment
  // credits are actually spent.
  let generatedThisTurn = false
  let generationInFlight = false

  return {
    ...edgeToolExecutors,
    ...(image
      ? {
          generate_image: async (args: Record<string, unknown>) => {
            if (generatedThisTurn || generationInFlight) {
              return 'I can only create one image per reply, and I already made one for this message.'
            }
            const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : ''
            if (!prompt) {
              return "I couldn't read that image request — could you describe it again?"
            }
            // Reserved synchronously — before the first await — so a concurrent
            // call cannot slip through.
            generationInFlight = true
            try {
              // The callable owns the credit spend and its own refund-on-failure,
              // so a throw here means nothing was charged.
              const generated = await generateImageViaCallable(prompt)
              // Consumed the instant credits are spent, NOT after the save: the
              // client has no refund path, so a persistence failure below must
              // never license a second billed generation.
              generatedThisTurn = true
              const imageId = generateSecureUuid()
              await saveCharacterImage({
                characterId,
                userId: image.userId,
                uri: `data:${generated.mimeType};base64,${generated.imageBase64}`,
                // The callable returns bytes only; MASTER_DIMENSION re-encodes
                // without resizing, exactly as useImageGeneration does.
                width: MASTER_DIMENSION,
                height: MASTER_DIMENSION,
                source: 'chat',
                // A pre-minted id for a message the turn has not written yet. If
                // the turn later fails, this row outlives the message that would
                // have rendered it — deliberately. messageId is not a foreign key
                // (migration 24), the image still appears in the character's
                // gallery, and deleting it would destroy an artifact the user has
                // already paid 200 credits for to tidy up a dangling reference.
                imageId,
                messageId: image.messageId,
              })
              image.onImageSaved(imageId)
              // Never the base64 — tool results are tokenized into model context.
              return JSON.stringify({ status: 'ok' })
            } catch (error) {
              console.error('[EdgeAgent] generate_image failed:', error)
              return "I wasn't able to create that image just now — want me to try again?"
            } finally {
              // Only the reservation is released. A generation that never billed
              // (the callable threw) leaves generatedThisTurn false, so the model
              // may retry within the turn.
              generationInFlight = false
            }
          },
        }
      : {}),
    // set_reminder is offered to the edge model as a stub the local executor
    // handles (Decision 0) — the producer used to live behind escalation that
    // production chat almost never took. Only wired in when a cloud character
    // row exists to schedule against; a local-only character has no Postgres
    // row, so the tool is not offered there at all (see getSchemasForEdge).
    ...(reminder
      ? {
          set_reminder: async (args: Record<string, unknown>) => {
            const reason = typeof args.reason === 'string' ? args.reason : ''
            const remindAt = typeof args.remind_at === 'string' ? args.remind_at : ''
            const priority =
              typeof args.priority === 'number' &&
              Number.isInteger(args.priority) &&
              args.priority >= 0 &&
              args.priority <= 10
                ? args.priority
                : undefined
            // Deterministic opId: same logical args → same opId → same server
            // row on retry. A network retry of this turn (or a replay of the
            // same call from a model that produced the same args twice) hits
            // ON CONFLICT DO NOTHING on the row's primary key and returns the
            // existing dueAt, instead of inserting a duplicate that the sweep
            // would later double-fire. SHA-256 (256-bit) over the canonical
            // string — see deriveOpId for the entropy rationale.
            const opId = await deriveOpId({
              characterId: reminder.characterId,
              reason,
              remindAt,
              priority,
            })
            try {
              // characterId comes from useEdgeAgent (cloud UUID), never from the
              // model — the callable verifies ownership against characters.user_id.
              const result = await reminder.scheduleWakeup({
                characterId: reminder.characterId,
                reason,
                remindAt,
                ...(priority !== undefined ? { priority } : {}),
                opId,
              })
              // Surfaces both success and semantic refusal (ceiling, malformed
              // remind_at, etc.) verbatim — the server strings are model-safe.
              return result.message
            } catch (error) {
              console.error('[EdgeAgent] set_reminder failed:', error)
              // Same catch-all string cloud-agent's set_reminder returns.
              return 'Not scheduled: an internal error occurred.'
            }
          },
        }
      : {}),
    wiki_read: async (args) => {
      try {
        const query = typeof args.query === 'string' ? args.query.trim() : ''
        if (!wiki || !query) return 'No relevant memories found.'
        const results = await readFromWiki(wiki, characterId, query)
        const hasMemories =
          results.facts.length > 0 || results.tasks.length > 0 || results.events.length > 0
        return hasMemories ? JSON.stringify(results) : 'No relevant memories found.'
      } catch (error) {
        console.error('[EdgeAgent] wiki_read failed:', error)
        return 'No relevant memories found.'
      }
    },
    wiki_write: async (args) => {
      try {
        const summary = typeof args.summary === 'string' ? args.summary.trim() : ''
        if (!wiki || !summary)
          return 'Failed to record observation: Invalid input or missing database.'
        await writeToWiki(wiki, characterId, { event_type: 'observation', summary })
        return 'Observation recorded successfully.'
      } catch (error) {
        console.error('[EdgeAgent] wiki_write failed:', error)
        return 'Failed to record observation due to an internal error.'
      }
    },
    create_task: async (args) => {
      try {
        const title = typeof args.title === 'string' ? args.title.trim() : ''
        if (!title) return 'Failed to create task: title is required.'
        const taskId = await createTask(characterId, title)
        return JSON.stringify({ taskId, title })
      } catch (error) {
        console.error('[EdgeAgent] create_task failed:', error)
        return 'Failed to create task due to an internal error.'
      }
    },
    list_tasks: async () => {
      try {
        const tasks = await listTasks(characterId)
        const open = tasks.filter((t: LocalTask) => t.status === 'pending' || t.status === 'open')
        if (open.length === 0) return 'No tasks found.'
        return JSON.stringify(
          open.map((t: LocalTask) => ({ id: t.id, title: t.title, status: 'open' })),
        )
      } catch (error) {
        console.error('[EdgeAgent] list_tasks failed:', error)
        return 'Failed to list tasks due to an internal error.'
      }
    },
    update_task: async (args) => {
      try {
        const taskId = typeof args.taskId === 'string' ? args.taskId.trim() : ''
        const title = typeof args.title === 'string' ? args.title.trim() : ''
        if (!taskId || !title) return 'Failed to update task: taskId and title are required.'
        await updateTask(characterId, taskId, title)
        return 'Task updated.'
      } catch (error) {
        console.error('[EdgeAgent] update_task failed:', error)
        return 'Failed to update task due to an internal error.'
      }
    },
    complete_task: async (args) => {
      try {
        const taskId = typeof args.taskId === 'string' ? args.taskId.trim() : ''
        if (!taskId) return 'Failed to complete task: taskId is required.'
        await completeTask(characterId, taskId)
        return 'Task marked as completed.'
      } catch (error) {
        console.error('[EdgeAgent] complete_task failed:', error)
        return 'Failed to complete task due to an internal error.'
      }
    },
    delete_task: async (args) => {
      try {
        const taskId = typeof args.taskId === 'string' ? args.taskId.trim() : ''
        if (!taskId) return 'Failed to delete task: taskId is required.'
        await deleteTask(characterId, taskId)
        return 'Task deleted.'
      } catch (error) {
        console.error('[EdgeAgent] delete_task failed:', error)
        return 'Failed to delete task due to an internal error.'
      }
    },
    document_search: async (args) => {
      try {
        const query = typeof args.query === 'string' ? args.query.trim() : ''
        if (!query) return 'No results found.'
        return 'Document search is not yet available on device.'
      } catch (error) {
        console.error('[EdgeAgent] document_search failed:', error)
        return 'Failed to search documents due to an internal error.'
      }
    },
    wiki_get_ontology: async () => {
      if (!wiki) return JSON.stringify({ mode: 'off', manifest: null })
      try {
        const result = await wiki.getOntologyManifest(characterId)
        return JSON.stringify(result ?? { mode: 'off', manifest: null })
      } catch (error) {
        console.error('[EdgeAgent] wiki_get_ontology failed:', error)
        return JSON.stringify({ mode: 'off', manifest: null })
      }
    },
    wiki_traverse_graph: async (args) => {
      try {
        const sourceId = typeof args.sourceId === 'string' ? args.sourceId.trim() : ''
        if (!sourceId) return 'Failed to traverse graph: sourceId is required.'
        if (!wiki) return 'Failed to traverse graph: wiki database is unavailable.'

        const maxDepthRaw =
          typeof args.maxDepth === 'number' && Number.isFinite(args.maxDepth)
            ? Math.trunc(args.maxDepth)
            : undefined
        const maxDepth =
          maxDepthRaw !== undefined ? Math.max(1, Math.min(maxDepthRaw, 3)) : undefined
        const direction =
          args.direction === 'inbound' || args.direction === 'outbound' || args.direction === 'both'
            ? args.direction
            : undefined
        const edgeTypes =
          Array.isArray(args.edgeTypes) && args.edgeTypes.every((t) => typeof t === 'string')
            ? (args.edgeTypes as string[])
            : undefined

        const neighborhood = await wiki.traverseGraph(characterId, {
          sourceId,
          maxDepth,
          direction,
          edgeTypes,
        })
        return formatGraphContext(neighborhood)
      } catch (error) {
        console.error('[EdgeAgent] wiki_traverse_graph failed:', error)
        return 'Failed to traverse graph due to an internal error.'
      }
    },
  }
}
