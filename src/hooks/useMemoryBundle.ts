import { useCallback, useEffect, useRef, useState } from 'react'
import { useWiki, type MemoryBundle } from '@equationalapplications/expo-llm-wiki'
import { reportError } from '~/utilities/reportError'

export function useMemoryBundle(entityId: string) {
  const wiki = useWiki()
  const [bundle, setBundle] = useState<MemoryBundle | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const fetchGenerationRef = useRef(0)
  const prevEntityIdRef = useRef(entityId)
  const prevWikiRef = useRef(wiki)

  if (prevEntityIdRef.current !== entityId || prevWikiRef.current !== wiki) {
    prevEntityIdRef.current = entityId
    prevWikiRef.current = wiki
    fetchGenerationRef.current += 1
  }

  const fetch = useCallback(async () => {
    const gen = ++fetchGenerationRef.current

    if (!wiki) {
      if (gen === fetchGenerationRef.current) {
        setIsLoading(false)
      }
      return
    }

    if (gen === fetchGenerationRef.current) {
      setIsLoading(true)
      setError(null)
    }

    try {
      const result = await wiki.getMemoryBundle(entityId)
      if (gen !== fetchGenerationRef.current) {
        return
      }
      setBundle(result)
    } catch (err) {
      if (gen !== fetchGenerationRef.current) {
        return
      }
      const normalized = err instanceof Error ? err : new Error(String(err))
      setError(normalized)
      reportError(normalized, `wiki:${entityId}:getMemoryBundle`)
    } finally {
      if (gen === fetchGenerationRef.current) {
        setIsLoading(false)
      }
    }
  }, [wiki, entityId])

  useEffect(() => {
    setBundle(null)
    setError(null)
    setIsLoading(true)
    void fetch()
  }, [fetch])

  return { bundle, isLoading, error, refetch: fetch }
}
