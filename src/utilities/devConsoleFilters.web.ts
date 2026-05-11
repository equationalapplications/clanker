let installed = false
let originalConsoleError: (typeof console)['error'] | null = null

const GIS_PREFIXES = ['[GSI_LOGGER]', "Provider's accounts list is empty."]

export const resetGoogleIdentityConsoleFilterForTests = (): void => {
  if (originalConsoleError) {
    console.error = originalConsoleError
    originalConsoleError = null
  }
  installed = false
}

export const installGoogleIdentityConsoleFilter = (): void => {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return
  if (installed) return
  installed = true

  originalConsoleError = console.error.bind(console)
  console.error = (...args: unknown[]) => {
    const first = args[0]
    if (typeof first === 'string' && GIS_PREFIXES.some((p) => first.startsWith(p))) {
      console.warn(...args)
      return
    }
    originalConsoleError!(...args)
  }
}
