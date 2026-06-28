export function resample24to16(pcm24: Uint8Array): Uint8Array {
  const inputSamples = Math.floor(pcm24.length / 2)
  const groups = Math.floor(inputSamples / 3)
  const out = new Uint8Array(groups * 4)

  let outIdx = 0
  for (let g = 0; g < groups; g++) {
    const base = g * 3
    const s0 = readSample(pcm24, base)
    const s1 = readSample(pcm24, base + 1)
    const s2 = readSample(pcm24, base + 2)
    writeSample(out, outIdx++, s0)
    writeSample(out, outIdx++, Math.round((s1 + s2) / 2))
  }

  return out
}

function readSample(pcm: Uint8Array, i: number): number {
  const u16 = pcm[i * 2] | (pcm[i * 2 + 1] << 8)
  return u16 >= 0x8000 ? u16 - 0x10000 : u16
}

function writeSample(out: Uint8Array, i: number, val: number): void {
  const clamped = Math.max(-32768, Math.min(32767, val))
  const u16 = clamped < 0 ? clamped + 0x10000 : clamped
  out[i * 2] = u16 & 0xff
  out[i * 2 + 1] = (u16 >> 8) & 0xff
}
