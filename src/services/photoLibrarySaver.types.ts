/**
 * Outcome of a user-initiated photo-library save, shared by both platform
 * twins so a twin can never return a variant its consumer fails to map.
 *
 * `downloaded` exists only for the web twin: a browser has no photo library,
 * so Save degrades to a browser download; the native twin never returns it.
 */
export type PhotoSaveResult = 'saved' | 'denied' | 'downloaded' | 'failed'

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
