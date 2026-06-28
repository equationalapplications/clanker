import { resample24to16 } from '~/utils/audioResample'

function makePcm24Sine(samples: number): Uint8Array {
  const out = new Uint8Array(samples * 2)
  for (let i = 0; i < samples; i++) {
    const val = Math.round(Math.sin((2 * Math.PI * 440 * i) / 24000) * 16000)
    const u16 = val < 0 ? val + 0x10000 : val
    out[i * 2] = u16 & 0xff
    out[i * 2 + 1] = (u16 >> 8) & 0xff
  }
  return out
}

function makeSilence(samples: number): Uint8Array {
  return new Uint8Array(samples * 2)
}

describe('resample24to16', () => {
  test('1ms of 24kHz sine (48 samples) → 32 output samples (64 bytes)', () => {
    const input = makePcm24Sine(48)
    const output = resample24to16(input)
    expect(output.length).toBe(64)
  })

  test('output sample count = floor(inputSamples / 3) * 2', () => {
    const input = makePcm24Sine(99)
    const output = resample24to16(input)
    expect(output.length).toBe(132)
  })

  test('silence in → silence out (no DC offset)', () => {
    const input = makeSilence(48)
    const output = resample24to16(input)
    expect(output.every((b) => b === 0)).toBe(true)
  })

  test('odd-length input (incomplete sample) does not throw', () => {
    const input = new Uint8Array(7)
    expect(() => resample24to16(input)).not.toThrow()
  })

  test('input with 0 samples returns empty Uint8Array', () => {
    expect(resample24to16(new Uint8Array(0)).length).toBe(0)
  })

  test('output sample 0 equals input sample 0 (pass-through for first of each group)', () => {
    const input = new Uint8Array(6)
    input[0] = 0xe8
    input[1] = 0x03
    input[2] = 0xd0
    input[3] = 0x07
    input[4] = 0xa0
    input[5] = 0x0f
    const output = resample24to16(input)
    const out0 = output[0] | (output[1] << 8)
    expect(out0).toBe(1000)
    const out1 = output[2] | (output[3] << 8)
    expect(out1).toBe(3000)
  })

  test('negative sample values preserved correctly (16-bit signed LE)', () => {
    const input = new Uint8Array(6)
    const u0 = -1000 + 0x10000
    input[0] = u0 & 0xff
    input[1] = (u0 >> 8) & 0xff
    const u1 = -2000 + 0x10000
    input[2] = u1 & 0xff
    input[3] = (u1 >> 8) & 0xff
    const u2 = -4000 + 0x10000
    input[4] = u2 & 0xff
    input[5] = (u2 >> 8) & 0xff

    const output = resample24to16(input)
    const raw0 = output[0] | (output[1] << 8)
    const signed0 = raw0 >= 0x8000 ? raw0 - 0x10000 : raw0
    expect(signed0).toBe(-1000)
    const raw1 = output[2] | (output[3] << 8)
    const signed1 = raw1 >= 0x8000 ? raw1 - 0x10000 : raw1
    expect(signed1).toBe(-3000)
  })
})
