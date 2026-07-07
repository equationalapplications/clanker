export function isDevSandboxEnabled(): boolean {
  const isDevBuild =
    typeof __DEV__ !== 'undefined' ? __DEV__ : process.env.NODE_ENV !== 'production'
  return isDevBuild && process.env.EXPO_PUBLIC_USE_MOCK_AUTH === 'true'
}
