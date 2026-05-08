import { generateNonce, sha256 } from '../nonce.web'

const cryptoMock = {
  getRandomValues: (arr: Uint8Array) => {
    for (let i = 0; i < arr.length; i++) arr[i] = i % 256
    return arr
  },
  subtle: {
    digest: async (_alg: string, data: ArrayBuffer) => {
      // Deterministic fake digest: 32 bytes equal to length of input
      const out = new Uint8Array(32).fill(data.byteLength % 256)
      return out.buffer
    },
  },
}

beforeAll(() => {
  Object.defineProperty(globalThis, 'crypto', { value: cryptoMock, configurable: true })
})

describe('nonce.web', () => {
  it('generateNonce returns a string of the requested length using charset chars', () => {
    const n = generateNonce(32)
    expect(n).toHaveLength(32)
    expect(n).toMatch(/^[A-Za-z0-9]{32}$/)
  })

  it('returns string of custom length (16)', () => {
    const n = generateNonce(16)
    expect(n).toHaveLength(16)
    expect(n).toMatch(/^[A-Za-z0-9]{16}$/)
  })

  it('returns string of custom length (64)', () => {
    const n = generateNonce(64)
    expect(n).toHaveLength(64)
    expect(n).toMatch(/^[A-Za-z0-9]{64}$/)
  })

  it('handles length=1', () => {
    const n = generateNonce(1)
    expect(n).toHaveLength(1)
    expect(n).toMatch(/^[A-Za-z0-9]$/)
  })

  it('throws on invalid length (negative)', () => {
    expect(() => generateNonce(-1)).toThrow('Invalid nonce length')
  })

  it('throws on invalid length (zero)', () => {
    expect(() => generateNonce(0)).toThrow('Invalid nonce length')
  })

  it('throws on non-integer length', () => {
    expect(() => generateNonce(32.5)).toThrow('Invalid nonce length')
  })

  it('sha256 returns lowercase hex of length 64', async () => {
    const hex = await sha256('hello')
    expect(hex).toMatch(/^[0-9a-f]{64}$/)
  })
})
