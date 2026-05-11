let installed = false

const GIS_PREFIXES = ['[GSI_LOGGER]', "Provider's accounts list is empty."]

export const resetGoogleIdentityConsoleFilterForTests = (): void => {
  installed = false
}

export const installGoogleIdentityConsoleFilter = (): void => {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return
  if (installed) return
  installed = true

  const originalError = console.error.bind(console)
  console.error = (...args: unknown[]) => {
    const first = args[0]
    if (typeof first === 'string' && GIS_PREFIXES.some((p) => first.startsWith(p))) {
      console.warn(...args)
      return
    }
    originalError(...args)
  }
}
