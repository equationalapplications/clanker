import { createMachine, assign, fromPromise, fromCallback } from 'xstate'
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

export interface WikiMachineContext {
  entityId: string
  wiki: Wiki
  status: EntityStatus
  lastError: Error | null
  lastReadAt: number | null
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

void fromPromise

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
    },
    states: {
      idle: {
        on: {
          READ: 'reading',
          WRITE: 'writing',
          INGEST: 'ingesting',
          SYNC: 'syncing',
          FORGET: 'forgetting',
        },
      },
      reading: {
        /* filled in P2a-3 */
      },
      writing: {
        /* filled in P2a-3 */
      },
      ingesting: {
        /* filled in P2a-3 */
      },
      syncing: {
        /* filled in P2a-3 */
      },
      forgetting: {
        /* filled in P2a-3 */
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
    },
  },
)
