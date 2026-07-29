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
  // What (imageId, variant) `uri` was actually resolved for. When the props
  // move on before the effect below has a chance to catch up, render derives
  // null instead of the stale previous URI — no synchronous setState needed
  // in the effect just to clear it between renders.
  const [resolvedFor, setResolvedFor] = useState<{ imageId: string; variant: ImageVariantName } | null>(null)

  useEffect(() => {
    let cancelled = false

    if (!imageId) return () => { cancelled = true }

    void (async () => {
      try {
        const row = await getCharacterImageById(imageId)
        if (cancelled) return
        if (!row) {
          setUri(null)
          setResolvedFor({ imageId, variant })
          return
        }
        const resolved = await resolveImageUri(row, variant)
        if (cancelled) return
        setUri(resolved)
        setResolvedFor({ imageId, variant })
      } catch (err) {
        console.warn('Failed to resolve character image:', imageId, variant, err)
        if (!cancelled) {
          setUri(null)
          setResolvedFor({ imageId, variant })
        }
      }
    })()

    return () => { cancelled = true }
  }, [imageId, variant])

  if (!imageId) return null
  if (!resolvedFor || resolvedFor.imageId !== imageId || resolvedFor.variant !== variant) return null
  return uri
}
