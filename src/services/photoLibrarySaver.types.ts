/**
 * Outcome of a user-initiated photo-library save, shared by both platform
 * twins so a twin can never return a variant its consumer fails to map.
 *
 * `unavailable` exists only for platforms with no photo library to save into;
 * the native twin never returns it.
 */
export type PhotoSaveResult = 'saved' | 'denied' | 'unavailable' | 'failed'

/**
 * The surface every platform twin of `~/services/photoLibrarySaver` must
 * expose. Both twins end with a compile-time assertion against this (same
 * pattern as `localImageStore.types.ts`) so a rename or signature change on
 * one side cannot silently desync the other — tsc typechecks consumers against
 * the native `.ts`, and nothing else would catch the web twin drifting.
 */
export interface PhotoLibrarySaver {
  /** Maps every outcome to a result; never rejects. */
  saveToPhotos(uri: string): Promise<PhotoSaveResult>
}
