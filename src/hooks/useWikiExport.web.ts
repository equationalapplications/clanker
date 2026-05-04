import type { MemoryDump } from '@equationalapplications/expo-llm-wiki'

function createWikiExportUnsupportedError(): Error {
  return new Error('Wiki export is not supported on web.')
}

// Web: WikiProvider is not mounted on web, so expose an explicit unsupported state.
// Wiki sync will be restored once expo-llm-wiki supports the WASM SQLite build.
export function useWikiExport() {
  return {
    execute: async (_entityIds?: string[]): Promise<MemoryDump> => {
      throw createWikiExportUnsupportedError()
    },
    isPending: false,
  }
}
