import { setSignedInHint, hasSignedInHint } from '~/utilities/signedInHint.web'
import { SIGNED_IN_HINT_KEY } from '~/config/siteConfig'

function memoryStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    map,
  }
}

describe('signedInHint (web)', () => {
  it('writes "1" under the shared key when signed in', () => {
    const storage = memoryStorage()
    setSignedInHint(true, storage)
    expect(storage.map.get(SIGNED_IN_HINT_KEY)).toBe('1')
    expect(hasSignedInHint(storage)).toBe(true)
  })

  it('removes the key when signed out', () => {
    const storage = memoryStorage()
    setSignedInHint(true, storage)
    setSignedInHint(false, storage)
    expect(storage.map.has(SIGNED_IN_HINT_KEY)).toBe(false)
    expect(hasSignedInHint(storage)).toBe(false)
  })

  it('swallows storage errors instead of breaking auth bootstrap', () => {
    const throwing = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
      removeItem: () => {
        throw new Error('blocked')
      },
    }
    expect(() => setSignedInHint(true, throwing)).not.toThrow()
    expect(hasSignedInHint(throwing)).toBe(false)
  })

  it('defaults to window.localStorage', () => {
    window.localStorage.removeItem(SIGNED_IN_HINT_KEY)
    setSignedInHint(true)
    expect(window.localStorage.getItem(SIGNED_IN_HINT_KEY)).toBe('1')
    expect(hasSignedInHint()).toBe(true)
    setSignedInHint(false)
    expect(window.localStorage.getItem(SIGNED_IN_HINT_KEY)).toBeNull()
    expect(hasSignedInHint()).toBe(false)
  })

  it('uses the same key the landing page script reads', () => {
    const landing = require('fs').readFileSync(require('path').resolve(__dirname, '..', 'landing', 'index.html'), 'utf8')
    expect(landing).toContain(`localStorage.getItem(${JSON.stringify(SIGNED_IN_HINT_KEY)})==='1'`)
  })
})
