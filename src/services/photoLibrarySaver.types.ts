/**
 * Outcome of a user-initiated photo-library save, shared by both platform
 * twins so a twin can never return a variant its consumer fails to map.
 *
 * `unavailable` exists only for platforms with no photo library to save into;
 * the native twin never returns it.
 */
export type PhotoSaveResult = 'saved' | 'denied' | 'unavailable' | 'failed'
