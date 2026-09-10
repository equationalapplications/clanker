/**
 * Outcome of a user-initiated image share, shared by both platform twins so a
 * twin can never return a variant its consumer fails to map.
 *
 * `cancelled` means the user dismissed the share sheet — not an error, so the
 * consumer must stay silent. `downloaded` exists only for the web twin's
 * fallback (share the file via a browser download when `navigator.share`
 * cannot take it); the native twin never returns it.
 */
export type ImageShareResult = 'shared' | 'downloaded' | 'cancelled' | 'unavailable' | 'failed'

/**
 * The surface every platform twin of `~/services/imageSharer` must expose.
 * Both twins end with a compile-time assertion against this (same pattern as
 * `photoLibrarySaver.types.ts`) so a rename or signature change on one side
 * cannot silently desync the other.
 */
export interface ImageSharer {
  /** Maps every outcome to a result; never rejects. */
  shareImage(uri: string): Promise<ImageShareResult>
}
