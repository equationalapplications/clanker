import { createMachine, assign, fromPromise, fromCallback, enqueueActions } from 'xstate'
import {
  WikiBusyError,
  type EntityStatus,
  type MemoryDump,
} from '@equationalapplications/expo-llm-wiki'
import type { Wiki } from '~/services/wikiService'
import { reportError } from '~/utilities/reportError'

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
 * Mutation events that get serialized: only one in-flight at a time. If a new
 * one arrives while a state is busy, it is appended to `pendingEvents` and
 * replayed when the machine returns to `idle`.
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
}

export type WikiMachineEvents =
  | { type: 'READ'; query: string }
  | { type: 'WRITE'; summary: string }
  | { type: 'INGEST'; doc: IngestArgs }
  | {
      type: 'SYNC'
      cloudId: string
      runRemoteSync: (dump: MemoryDump) => Promise<MemoryDump | null>
    }
  | { type: 'FORGET'; args: ForgetArgs }
  | { type: 'STATUS'; status: EntityStatus }
  | { type: 'RETRY' }

export interface WikiMachineInput {
  entityId: string
  wiki: Wiki
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
    }),
    invoke: {
      id: 'subscribeStatus',
      src: 'subscribeStatus',
      input: ({ context }) => ({ wiki: context.wiki, entityId: context.entityId }),
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
          READ: 'reading',
          WRITE: 'writing',
          INGEST: 'ingesting',
          SYNC: 'syncing',
          FORGET: 'forgetting',
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
          onDone: { target: 'idle', actions: assign({ lastReadAt: () => Date.now() }) },
          onError: [
            { guard: 'isBusyError', target: 'idle' },
            {
              target: 'error',
              actions: assign({ lastError: ({ event }) => event.error as Error }),
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
          onDone: 'idle',
          onError: [
            { guard: 'isBusyError', target: 'idle' },
            {
              target: 'error',
              actions: assign({ lastError: ({ event }) => event.error as Error }),
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
          onDone: 'idle',
          onError: [
            { guard: 'isBusyError', target: 'idle' },
            {
              target: 'error',
              actions: assign({ lastError: ({ event }) => event.error as Error }),
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
            cloudId: (event as Extract<WikiMachineEvents, { type: 'SYNC' }>).cloudId,
            runRemoteSync: (event as Extract<WikiMachineEvents, { type: 'SYNC' }>).runRemoteSync,
          }),
          onDone: 'idle',
          onError: [
            { guard: 'isBusyError', target: 'idle' },
            {
              target: 'error',
              actions: assign({ lastError: ({ event }) => event.error as Error }),
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
          onDone: 'idle',
          onError: [
            { guard: 'isBusyError', target: 'idle' },
            {
              target: 'error',
              actions: assign({ lastError: ({ event }) => event.error as Error }),
            },
          ],
        },
      },
      error: {
        entry: ['recordError'],
        on: { RETRY: 'idle' },
        after: { 30000: 'idle' },
      },
    },
  },
  {
    actions: {
      recordError: ({ context }) => {
        if (context.lastError && !(context.lastError instanceof WikiBusyError)) {
          reportError(context.lastError, `wiki:${context.entityId}`)
        }
      },
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
    actors: {
      subscribeStatus: fromCallback<WikiMachineEvents, { wiki: Wiki; entityId: string }>(
        ({ sendBack, input }) => {
          const unsubscribe = input.wiki.subscribeEntityStatus(input.entityId, (status) => {
            sendBack({ type: 'STATUS', status })
          })
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
            cloudId: string
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
