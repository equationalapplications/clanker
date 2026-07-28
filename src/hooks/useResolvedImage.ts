import { useEffect, useState } from 'react'
import { getCharacterImageById } from '~/database/characterImageDatabase'
import { resolveImageUri } from '~/services/localImageStore'

export type ImageVariantName = 'master' | 'thumb'

/**
 * Resolve a `character_images` row id to a renderable URI.
 *
 * Returns null rather than throwing on any failure: CharacterAvatar's own
 * fallback chain (master → thumb → bundled default) is the recovery path, and a
 * throwing hook would take the whole screen down for a missing thumbnail.
 */
export function useResolvedImage(
  imageId: string | null | undefined,
  variant: ImageVariantName = 'master',
): string | null {
  const [uri, setUri] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    if (!imageId) {
      setUri(null)
      return () => { cancelled = true }
    }

    void (async () => {
      try {
        const row = await getCharacterImageById(imageId)
        if (cancelled) return
        if (!row) {
          setUri(null)
          return
        }
        const resolved = await resolveImageUri(row, variant)
        if (!cancelled) setUri(resolved)
      } catch (err) {
        console.warn('Failed to resolve character image:', imageId, variant, err)
        if (!cancelled) setUri(null)
      }
    })()

    return () => { cancelled = true }
  }, [imageId, variant])

  return uri
}
