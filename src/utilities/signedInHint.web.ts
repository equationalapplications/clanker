// Web-only. Mirrors Firebase auth state into a localStorage flag that the
// static landing page at `/` reads synchronously (landing/index.html, generated
// by scripts/generate-static-pages.js) to send signed-in visitors straight to
// the app. Firebase persists sessions in IndexedDB, which an inline script
// cannot read before first paint; this flag can. It is only a hint: a stale
// value costs one redirect to /sign-in and is corrected on the next auth event.
import { SIGNED_IN_HINT_KEY } from '~/config/siteConfig'

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function defaultStorage(): StorageLike | undefined {
  try {
    return typeof window !== 'undefined' ? window.localStorage : undefined
  } catch {
    // Access itself throws in some privacy modes.
    return undefined
  }
}

export function setSignedInHint(signedIn: boolean, storage = defaultStorage()): void {
  if (!storage) return
  try {
    if (signedIn) storage.setItem(SIGNED_IN_HINT_KEY, '1')
    else storage.removeItem(SIGNED_IN_HINT_KEY)
  } catch {
    // Quota or privacy-mode errors: the landing page falls back to the form.
  }
}

export function hasSignedInHint(storage = defaultStorage()): boolean {
  if (!storage) return false
  try {
    return storage.getItem(SIGNED_IN_HINT_KEY) === '1'
  } catch {
    return false
  }
}
