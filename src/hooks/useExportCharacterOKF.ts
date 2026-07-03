import { useCallback, useEffect, useRef, useState } from 'react'
import { useWiki, formatOkfBundle } from '@equationalapplications/expo-llm-wiki'
import { buildOkfReadmeContent } from '~/constants/okfReadmeContent'
import { augmentWithEdgeLinks } from '~/utils/augmentWithEdgeLinks'
import { reportError } from '~/utilities/reportError'
import { zipAndSaveOKF } from '~/utilities/okfSave'

type OkfFile = ReturnType<typeof formatOkfBundle>['files'][number]

interface ExportResult {
  isEmpty: boolean
}

export function useExportCharacterOKF(characterId: string, characterName: string) {
  const wiki = useWiki()
  const [isExporting, setIsExporting] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [lastResult, setLastResult] = useState<ExportResult | null>(null)
  const inFlightRef = useRef(false)
  const characterNameRef = useRef(characterName)

  useEffect(() => {
    characterNameRef.current = characterName
  }, [characterName])

  const exportOkf = useCallback(async () => {
    if (inFlightRef.current) return

    inFlightRef.current = true
    setIsExporting(true)
    setError(null)
    setLastResult(null)

    try {
      const dump = await wiki.exportDump([characterId])
      const entity = dump.entities[characterId]
      const isEmpty =
        !entity ||
        (entity.facts.length === 0 &&
          entity.tasks.length === 0 &&
          entity.events.length === 0)

      const { files } = formatOkfBundle(dump)
      const augmented = augmentWithEdgeLinks(files, entity?.edges ?? [])
      const filesWithReadme: OkfFile[] = [
        ...augmented,
        { path: 'README.md', content: buildOkfReadmeContent() },
      ]

      await zipAndSaveOKF({
        characterName: characterNameRef.current,
        files: filesWithReadme,
      })

      setLastResult({ isEmpty })
    } catch (err) {
      const normalized = err instanceof Error ? err : new Error(String(err))
      setError(normalized)
      reportError(normalized, `okf-export:${characterId}`)
    } finally {
      inFlightRef.current = false
      setIsExporting(false)
    }
  }, [wiki, characterId])

  return { exportOkf, isExporting, error, lastResult }
}
