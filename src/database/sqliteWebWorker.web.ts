/**
 * Tracks the expo-sqlite Web Worker so we can terminate it on pagehide.
 * Do not terminate during in-page OPFS retries — expo-sqlite keeps a module-level
 * reference to the worker and further openDatabaseAsync calls hang on a dead worker.
 */

let sqliteWorker: Worker | null = null
let trackerInstalled = false

function isSqliteWorkerUrl(scriptURL: string | URL): boolean {
  const url = String(scriptURL)
  // expo-sqlite bundles its worker as a separate chunk whose URL contains "worker".
  return url.includes('worker')
}

export function installSqliteWorkerTracker(): void {
  if (trackerInstalled || typeof window === 'undefined') return
  trackerInstalled = true

  const OriginalWorker = window.Worker
  window.Worker = class PatchedWorker extends OriginalWorker {
    constructor(scriptURL: string | URL, options?: WorkerOptions) {
      super(scriptURL, options)
      if (isSqliteWorkerUrl(scriptURL)) {
        sqliteWorker = this
      }
    }
  } as typeof Worker
}

export function terminateSqliteWebWorker(): void {
  if (!sqliteWorker) return
  sqliteWorker.terminate()
  sqliteWorker = null
}
