import { useCallback, useRef, useState } from 'react'
import { useWiki, parseOkfBundle, WikiBusyError } from '@equationalapplications/expo-llm-wiki'
import { reportError } from '~/utilities/reportError'
import { pickAndReadOkfBundle, OkfPickCancelledError, type OkfFile } from '~/utilities/okfImport'
import { remapOkfDumpIds } from '~/utilities/okfImportRemap'
import { dedupeEventsAgainstExisting } from '~/utilities/okfImportDedupe'

export interface OkfPreviewStats {
  facts: number
  tasks: number
  events: number
  edges: number
}

export type ImportMode = 'merge' | 'replace' | 'clone'

export function useImportCharacterOKF() {
  const wiki = useWiki()
  const [isParsing, setIsParsing] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [preview, setPreview] = useState<OkfPreviewStats | null>(null)
  const [error, setError] = useState<(Error & { displayMessage?: string }) | null>(null)
  const [didImport, setDidImport] = useState(false)
  // Cache raw files, not a parsed MemoryDump — the clone path doesn't know
  // the real target entity id until after the character record is created,
  // so parsing happens once at preview (display counts only) and again for
  // real at commit.
  const filesRef = useRef<OkfFile[] | null>(null)
  const inFlightRef = useRef(false)

  const handlePickAndPreview = useCallback(async (previewEntityId: string) => {
    if (inFlightRef.current) return
    inFlightRef.current = true
    setIsParsing(true)
    setError(null)
    setPreview(null)
    setDidImport(false)
    try {
      const files = await pickAndReadOkfBundle()
      filesRef.current = files
      const dump = parseOkfBundle(previewEntityId, files)
      const entity = dump.entities[previewEntityId]
      setPreview({
        facts: entity?.facts.length ?? 0,
        tasks: entity?.tasks.length ?? 0,
        events: entity?.events.length ?? 0,
        edges: entity?.edges?.length ?? 0,
      })
    } catch (err) {
      if (err instanceof OkfPickCancelledError) return
      const normalized = err instanceof Error ? err : new Error(String(err))
      setError(normalized)
      reportError(normalized, 'okf-import:preview')
    } finally {
      inFlightRef.current = false
      setIsParsing(false)
    }
  }, [])

  const handleCommitImport = useCallback(
    async (targetEntityId: string, mode: ImportMode): Promise<boolean> => {
      if (!filesRef.current || inFlightRef.current) return false
      inFlightRef.current = true
      setIsImporting(true)
      setError(null)
      try {
        let dump = parseOkfBundle(targetEntityId, filesRef.current)
        if (mode === 'clone') {
          dump = remapOkfDumpIds(dump, targetEntityId)
        } else {
          dump = await dedupeEventsAgainstExisting(wiki, targetEntityId, dump)
        }
        await wiki.importDump(dump, mode === 'replace' ? { merge: false } : { merge: true })
        filesRef.current = null
        setPreview(null)
        setDidImport(true)
        return true
      } catch (err) {
        const normalized = err instanceof Error ? err : new Error(String(err))
        if (err instanceof WikiBusyError) {
          setError(
            Object.assign(normalized, {
              displayMessage: 'Memory is busy right now — try again in a moment.',
            }),
          )
        } else {
          setError(normalized)
        }
        reportError(normalized, `okf-import:${targetEntityId}`)
        return false
      } finally {
        inFlightRef.current = false
        setIsImporting(false)
      }
    },
    [wiki],
  )

  const handleCancel = useCallback(() => {
    filesRef.current = null
    setPreview(null)
    setError(null)
  }, [])

  return {
    isParsing,
    isImporting,
    preview,
    error,
    didImport,
    handlePickAndPreview,
    handleCommitImport,
    handleCancel,
  }
}
