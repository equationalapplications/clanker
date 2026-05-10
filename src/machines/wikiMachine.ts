import { createMachine, assign, fromPromise, fromCallback, enqueueActions } from 'xstate'
import {
  WikiBusyError,
  type EntityStatus,
  type MemoryDump,
} from '@equationalapplications/expo-llm-wiki'
import type { Wiki } from '~/services/wikiService'
import { reportError } from '~/utilities/reportError'

/**
 * Normalizes unknown error values from XState promise rejections into Error instances.
 * XState promise errors are typed as `unknown` and may not be Error objects.
 */
function normalizeError(error: unknown): Error {
  if (error instanceof Error) {
    return error
  }
  return new Error(String(error))
}

/**
 * Argument shape accepted by `Wiki.ingestDocument`. The package does not
 * export this as a named type, so we derive it from the method signature.
 */
export type IngestArgs = Parameters<Wiki['ingestDocument']>[1]

/**
 * Argument shape accepted by `Wiki.forget`. Derived from the method
 * signature for the same reason as `IngestArgs`.
 */
export type ForgetArgs = Parameters<Wiki['forget']>[1]

/**
 * Events that get serialized: only one in-flight at a time. If a new
 * one arrives while a state is busy, it is appended to `pendingEvents` and
 * replayed when the machine returns to `idle`. Includes READ to ensure
 * consistent ordering with mutations.
 */
export type WikiMutationEvent = Extract<
  WikiMachineEvents,
  { type: 'READ' | 'WRITE' | 'INGEST' | 'SYNC' | 'FORGET' }
>

export interface WikiMachineContext {
  entityId: string
  wiki: Wiki
  status: EntityStatus
  lastError: Error | null
  lastReadAt: number | null
  pendingEvents: WikiMutationEvent[]
  currentEvent: WikiMutationEvent | null
  busyRetryDelayMs: number
  statusPollIntervalMs: number
}

export type WikiMachineEvents =
  | { type: 'READ'; query: string }
  | { type: 'WRITE'; summary: string }
  | { type: 'INGEST'; doc: IngestArgs }
  | {
      type: 'SYNC'
      runRemoteSync: (dump: MemoryDump) => Promise<MemoryDump | null>
    }
  | { type: 'FORGET'; args: ForgetArgs }
  | { type: 'STATUS'; status: EntityStatus }
  | { type: 'RETRY' }

export interface WikiMachineInput {
  entityId: string
  wiki: Wiki
  /** Delay in ms before retrying after WikiBusyError. Default: 1000ms */
  busyRetryDelayMs?: number
  /**
   * When `subscribeEntityStatus` is missing, poll `getEntityStatus` at this interval (ms).
   * Default 5000. Set to 0 to emit the initial status only (no repeating timer).
   */
  statusPollIntervalMs?: number
}

export const wikiMachine = createMachine(
  {
    id: 'wikiMachine',
    types: {} as {
      context: WikiMachineContext
      events: WikiMachineEvents
      input: WikiMachineInput
    },
    initial: 'idle',
    context: ({ input }) => ({
      entityId: input.entityId,
      wiki: input.wiki,
      status: { ingesting: false, librarian: false, heal: false } as EntityStatus,
      lastError: null,
      lastReadAt: null,
      pendingEvents: [],
      currentEvent: null,
      busyRetryDelayMs: input.busyRetryDelayMs ?? 1000,
      statusPollIntervalMs: input.statusPollIntervalMs ?? 5000,
    }),
    invoke: {
      id: 'subscribeStatus',
      src: 'subscribeStatus',
      input: ({ context }) => ({
        wiki: context.wiki,
        entityId: context.entityId,
        statusPollIntervalMs: context.statusPollIntervalMs,
      }),
    },
    on: {
      STATUS: {
        actions: assign({ status: ({ event }) => event.status }),
      },
      READ: { actions: 'enqueueEvent' },
      WRITE: { actions: 'enqueueEvent' },
      INGEST: { actions: 'enqueueEvent' },
      SYNC: { actions: 'enqueueEvent' },
      FORGET: { actions: 'enqueueEvent' },
    },
    states: {
      idle: {
        entry: 'flushPending',
        on: {
          READ: { target: 'reading', actions: 'storeCurrentEvent' },
          WRITE: { target: 'writing', actions: 'storeCurrentEvent' },
          INGEST: { target: 'ingesting', actions: 'storeCurrentEvent' },
          SYNC: { target: 'syncing', actions: 'storeCurrentEvent' },
          FORGET: { target: 'forgetting', actions: 'storeCurrentEvent' },
        },
      },
      reading: {
        invoke: {
          src: 'readActor',
          input: ({ context, event }) => ({
            wiki: context.wiki,
            entityId: context.entityId,
            query: (event as Extract<WikiMachineEvents, { type: 'READ' }>).query,
          }),
          onDone: {
            target: 'idle',
            actions: assign({
              lastReadAt: () => Date.now(),
              lastError: () => null,
              currentEvent: () => null,
            }),
          },
          onError: [
            {
              guard: 'isBusyError',
              target: 'busyRetry',
              actions: 'requeueCurrentEvent',
            },
            {
              target: 'error',
              actions: assign({ lastError: ({ event }) => normalizeError(event.error) }),
            },
          ],
        },
      },
      writing: {
        invoke: {
          src: 'writeActor',
          input: ({ context, event }) => ({
            wiki: context.wiki,
            entityId: context.entityId,
            summary: (event as Extract<WikiMachineEvents, { type: 'WRITE' }>).summary,
          }),
          onDone: {
            target: 'idle',
            actions: assign({ lastError: () => null, currentEvent: () => null }),
          },
          onError: [
            {
              guard: 'isBusyError',
              target: 'busyRetry',
              actions: 'requeueCurrentEvent',
            },
            {
              target: 'error',
              actions: assign({ lastError: ({ event }) => normalizeError(event.error) }),
            },
          ],
        },
      },
      ingesting: {
        invoke: {
          src: 'ingestActor',
          input: ({ context, event }) => ({
            wiki: context.wiki,
            entityId: context.entityId,
            doc: (event as Extract<WikiMachineEvents, { type: 'INGEST' }>).doc,
          }),
          onDone: {
            target: 'idle',
            actions: assign({ lastError: () => null, currentEvent: () => null }),
          },
          onError: [
            {
              guard: 'isBusyError',
              target: 'busyRetry',
              actions: 'requeueCurrentEvent',
            },
            {
              target: 'error',
              actions: assign({ lastError: ({ event }) => normalizeError(event.error) }),
            },
          ],
        },
      },
      syncing: {
        invoke: {
          src: 'syncActor',
          input: ({ context, event }) => ({
            wiki: context.wiki,
            entityId: context.entityId,
            runRemoteSync: (event as Extract<WikiMachineEvents, { type: 'SYNC' }>).runRemoteSync,
          }),
          onDone: {
            target: 'idle',
            actions: assign({ lastError: () => null, currentEvent: () => null }),
          },
          onError: [
            {
              guard: 'isBusyError',
              target: 'busyRetry',
              actions: 'requeueCurrentEvent',
            },
            {
              target: 'error',
              actions: assign({ lastError: ({ event }) => normalizeError(event.error) }),
            },
          ],
        },
      },
      forgetting: {
        invoke: {
          src: 'forgetActor',
          input: ({ context, event }) => ({
            wiki: context.wiki,
            entityId: context.entityId,
            args: (event as Extract<WikiMachineEvents, { type: 'FORGET' }>).args,
          }),
          onDone: {
            target: 'idle',
            actions: assign({ lastError: () => null, currentEvent: () => null }),
          },
          onError: [
            {
              guard: 'isBusyError',
              target: 'busyRetry',
              actions: 'requeueCurrentEvent',
            },
            {
              target: 'error',
              actions: assign({ lastError: ({ event }) => normalizeError(event.error) }),
            },
          ],
        },
      },
      busyRetry: {
        after: {
          BUSY_RETRY_DELAY: {
            target: 'idle',
          },
        },
      },
      error: {
        entry: ['recordError'],
        on: {
          RETRY: {
            target: 'idle',
            actions: assign({ lastError: () => null, currentEvent: () => null }),
          },
        },
        after: {
          30000: {
            target: 'idle',
            actions: assign({ lastError: () => null, currentEvent: () => null }),
          },
        },
      },
    },
  },
  {
    actions: {
      recordError: ({ context }) => {
        if (context.lastError && !(context.lastError instanceof WikiBusyError)) {
          const operation = context.currentEvent?.type || 'unknown'
          reportError(context.lastError, `wiki:${context.entityId}:${operation}`)
        }
      },
      storeCurrentEvent: assign({
        currentEvent: ({ event }) => event as WikiMutationEvent,
      }),
      requeueCurrentEvent: assign({
        pendingEvents: ({ context }) =>
          context.currentEvent ? [context.currentEvent, ...context.pendingEvents] : context.pendingEvents,
        currentEvent: () => null,
      }),
      enqueueEvent: assign({
        pendingEvents: ({ context, event }) => [
          ...context.pendingEvents,
          event as WikiMutationEvent,
        ],
      }),
      flushPending: enqueueActions(({ context, enqueue }) => {
        if (context.pendingEvents.length === 0) return
        const [next, ...rest] = context.pendingEvents
        enqueue.assign({ pendingEvents: rest })
        enqueue.raise(next)
      }),
    },
    guards: {
      isBusyError: ({ event }) =>
        (event as { error?: unknown }).error instanceof WikiBusyError,
    },
    delays: {
      BUSY_RETRY_DELAY: ({ context }) => context.busyRetryDelayMs,
    },
    actors: {
      subscribeStatus: fromCallback<
        WikiMachineEvents,
        { wiki: Wiki; entityId: string; statusPollIntervalMs: number }
      >(({ sendBack, input }) => {
          // If subscribeEntityStatus is not available, use getEntityStatus with polling
          if (!input.wiki.subscribeEntityStatus) {
            // Fallback: poll getEntityStatus (interval from context; 0 = initial only)
            if (!input.wiki.getEntityStatus) {
              reportError(
                new Error(
                  `Neither subscribeEntityStatus nor getEntityStatus available for entity ${input.entityId}`,
                ),
                `wiki:${input.entityId}:statusSubscription`,
              )
              return () => {}
            }
            // Send initial status immediately
            const initialStatus = input.wiki.getEntityStatus(input.entityId)
            sendBack({ type: 'STATUS', status: initialStatus })

            const intervalMs = input.statusPollIntervalMs
            if (intervalMs <= 0) {
              return () => {}
            }
            const getStatus = input.wiki.getEntityStatus
            const interval = setInterval(() => {
              const status = getStatus(input.entityId)
              sendBack({ type: 'STATUS', status })
            }, intervalMs)
            return () => clearInterval(interval)
          }
          
          const unsubscribe = input.wiki.subscribeEntityStatus(
            input.entityId,
            (status: EntityStatus) => {
              sendBack({ type: 'STATUS', status })
            },
          )
          return unsubscribe
        },
      ),
      readActor: fromPromise(
        async ({
          input,
        }: {
          input: { wiki: Wiki; entityId: string; query: string }
        }) => {
          return input.wiki.read(input.entityId, input.query)
        },
      ),
      writeActor: fromPromise(
        async ({
          input,
        }: {
          input: { wiki: Wiki; entityId: string; summary: string }
        }) => {
          await input.wiki.write(input.entityId, {
            event_type: 'observation',
            summary: input.summary,
          })
        },
      ),
      ingestActor: fromPromise(
        async ({
          input,
        }: {
          input: { wiki: Wiki; entityId: string; doc: IngestArgs }
        }) => {
          await input.wiki.ingestDocument(input.entityId, input.doc)
        },
      ),
      forgetActor: fromPromise(
        async ({
          input,
        }: {
          input: { wiki: Wiki; entityId: string; args: ForgetArgs }
        }) => {
          await input.wiki.forget(input.entityId, input.args)
        },
      ),
      syncActor: fromPromise(
        async ({
          input,
        }: {
          input: {
            wiki: Wiki
            entityId: string
            runRemoteSync: (d: MemoryDump) => Promise<MemoryDump | null>
          }
        }) => {
          const local = await input.wiki.exportDump([input.entityId])
          const remote = await input.runRemoteSync(local)
          if (remote) {
            await input.wiki.importDump(remote, { merge: true })
          }
          await input.wiki.runPrune(input.entityId, { vacuum: false })
        },
      ),
    },
  },
)
