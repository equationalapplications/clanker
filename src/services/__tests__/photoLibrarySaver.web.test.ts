/**
 * The ONLY suite that executes the web twin of the photo-save seam.
 *
 * Jest resolves the bare `~/services/photoLibrarySaver` specifier to the
 * native .ts twin (jest-expo has no platform-suffix mapping), so without this
 * explicit-extension import nothing in CI ever loads photoLibrarySaver.web.ts.
 * That matters beyond coverage: if `expo-media-library` ever enters this
 * file's import graph, its main entry calls requireNativeModule at module
 * scope and THIS import throws under Jest — catching the exact web-crash
 * class the seam exists to prevent, which tsc and every other suite are blind
 * to.
 */
import { saveToPhotos } from '../photoLibrarySaver.web'

describe('saveToPhotos (web twin)', () => {
  it('loads without any native module and degrades to unavailable', async () => {
    await expect(saveToPhotos('file:///cache/master.webp')).resolves.toBe('unavailable')
  })
})
