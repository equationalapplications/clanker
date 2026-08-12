/**
 * Shared contract for the platform-specific local image stores.
 *
 * Metro picks `localImageStore.web.ts` on web and `localImageStore.ts` everywhere
 * else, so nothing forces the two files to agree. Both implementations end with a
 * compile-time assertion against `LocalImageStore` here, which is what actually
 * keeps the surfaces in lockstep as Stage B/C/D add to them.
 */

import type { CharacterImageRow } from '~/database/characterImageDatabase'

export type ImageVariantName = 'master' | 'thumb'

export interface LocalImageStore {
  resolveImageUri(row: CharacterImageRow, variant: ImageVariantName): Promise<string>
  writeLocalImageBytes(imageId: string, base64: string, variant: ImageVariantName): Promise<string>
  deleteLocalImageBytes(ref: string): Promise<void>
}
