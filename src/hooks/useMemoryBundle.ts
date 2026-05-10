import { useCallback, useEffect, useState } from 'react'
import { useWiki, type MemoryBundle } from '@equationalapplications/expo-llm-wiki'
import { reportError } from '~/utilities/reportError'

export function useMemoryBundle(entityId: string) {
  const wiki = useWiki()
  const [bundle, setBundle] = useState<MemoryBundle | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const fetch = useCallback(async () => {
    if (!wiki) {
      setIsLoading(false)
      return
    }
    setIsLoading(true)
    setError(null)
    try {
      const result = await wiki.getMemoryBundle(entityId)
      setBundle(result)
    } catch (err) {
      const normalized = err instanceof Error ? err : new Error(String(err))
      setError(normalized)
      reportError(normalized, `wiki:${entityId}:getMemoryBundle`)
    } finally {
      setIsLoading(false)
    }
  }, [wiki, entityId])

  useEffect(() => {
    void fetch()
  }, [fetch])

  return { bundle, isLoading, error, refetch: fetch }
}
