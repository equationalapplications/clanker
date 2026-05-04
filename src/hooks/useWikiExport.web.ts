import type { MemoryDump } from '@equationalapplications/expo-llm-wiki'

// Web: WikiProvider is not mounted on web, so return a safe no-op.
// Wiki sync will be restored once expo-llm-wiki supports the WASM SQLite build.
export function useWikiExport() {
  return {
    execute: async (_entityIds?: string[]): Promise<MemoryDump> => ({
      generatedAt: Date.now(),
      entities: {},
    }),
    isPending: false,
  }
}
