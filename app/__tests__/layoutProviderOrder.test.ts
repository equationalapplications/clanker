/**
 * Invariant: PersistQueryClientProvider MUST wrap GlobalStateProvider in the
 * root layout. GlobalStateProvider renders AppOrchestrator, whose
 * useProactiveSync and useProactiveNotificationRouting both call
 * useQueryClient(); with the query provider nested inside, those hooks throw
 * "No QueryClient set" during render and the app mounts a blank page on every
 * platform. That exact regression shipped once and was fixed by hoisting the
 * query provider — this test is what fails if it is ever nested back.
 *
 * A render-level test cannot express this invariant: mounting RootLayout pulls
 * in the whole app (expo-router Stack, native modules, database init), and
 * every hook suite wraps itself in its own QueryClientProvider, so a reorder
 * fails no test at render time. eslint's selector language cannot express JSX
 * ancestry either. The guard is therefore structural: assert the nesting
 * directly on the layout source, with comments stripped so the explanatory
 * comment in the JSX (which names both providers) cannot satisfy it.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Remove // and /* *\/ comments while leaving string literals untouched, so a
 * provider name appearing only in prose can never satisfy the nesting
 * assertion below. Tracks quote state and backslash escapes; anything inside
 * quotes is copied verbatim.
 */
function stripComments(source: string): string {
  let out = ''
  let i = 0
  while (i < source.length) {
    const char = source[i]
    const next = source[i + 1] ?? ''
    if (char === '/' && next === '*') {
      i += 2
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++
      i += 2
      out += ' '
      continue
    }
    if (char === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i++
      continue
    }
    if (char === "'" || char === '"' || char === '`') {
      const quote = char
      out += char
      i++
      while (i < source.length && source[i] !== quote) {
        // Copy escape pairs verbatim so \' inside a string cannot end it.
        if (source[i] === '\\') {
          out += source[i] + (source[i + 1] ?? '')
          i += 2
          continue
        }
        out += source[i]
        i++
      }
      out += quote
      i++
      continue
    }
    out += char
    i++
  }
  return out
}

function layoutSourceWithoutComments(): string {
  return stripComments(readFileSync(path.join(__dirname, '..', '_layout.tsx'), 'utf8'))
}

describe('root layout provider order', () => {
  it('nests GlobalStateProvider inside PersistQueryClientProvider', () => {
    const source = layoutSourceWithoutComments()
    const openPersist = source.indexOf('<PersistQueryClientProvider')
    const closePersist = source.indexOf('</PersistQueryClientProvider>')
    const openGlobal = source.indexOf('<GlobalStateProvider')
    const closeGlobal = source.indexOf('</GlobalStateProvider>')

    expect(openPersist).toBeGreaterThanOrEqual(0)
    expect(closePersist).toBeGreaterThan(openPersist)
    expect(openGlobal).toBeGreaterThanOrEqual(0)
    expect(closeGlobal).toBeGreaterThan(openGlobal)

    // The actual invariant: the query provider both opens before and closes
    // after the global-state provider — i.e. it wraps it, not merely precedes
    // it as a sibling.
    expect(openPersist).toBeLessThan(openGlobal)
    expect(closeGlobal).toBeLessThan(closePersist)
  })

  it('still detects the regression when the explanatory comment is deleted', () => {
    // Guard the guard: run the stripper over a worst-case source where the
    // provider names appear ONLY in comments, and confirm neither provider is
    // found. If stripComments ever stopped removing comments, the main test
    // above could keep passing off prose instead of JSX.
    const stripped = stripComments(
      'const x = 1 // <PersistQueryClientProvider> <GlobalStateProvider>\n' +
        '/* </GlobalStateProvider> </PersistQueryClientProvider> */\n' +
        'const y = "literal with // and /* inside stays"\n',
    )
    expect(stripped).not.toContain('<PersistQueryClientProvider')
    expect(stripped).not.toContain('<GlobalStateProvider')
    expect(stripped).toContain('const y = "literal with // and /* inside stays"')
  })
})
