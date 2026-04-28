/**
 * Document ingest progress mapping.
 * Maps state names to 0..1 progress values.
 * Used by both documentIngestMachine and IngestProgressBar for consistency.
 */
export const INGEST_STATE_PROGRESS: Record<string, number> = {
  idle: 0,
  picking: 0,
  reading: 0.1,
  checkingDuplicate: 0.2,
  confirmingDuplicate: 0.3,
  purging: 0.3,
  extracting: 0.5,
  applying: 0.9,
  success: 1.0,
  error: 0,
}
