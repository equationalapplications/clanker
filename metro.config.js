// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config')
const path = require('path')

const config = getDefaultConfig(__dirname)

// Prevent Metro from crawling the Firebase Functions directory.
// Functions are a separate Node.js runtime and must not be bundled into the app.
const functionsDir = path.resolve(__dirname, 'functions')
// Escape all RegExp metacharacters in the resolved path (e.g. dots in usernames
// on Windows like C:\Users\john.doe\...) before building the blockList pattern.
const escapedFunctionsDir = functionsDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
config.resolver.blockList = [
  ...(Array.isArray(config.resolver.blockList)
    ? config.resolver.blockList
    : config.resolver.blockList
      ? [config.resolver.blockList]
      : []),
  new RegExp(escapedFunctionsDir + '/.*'),
]

// NOTE: '.cjs' must NOT be added to assetExts. It is already in Expo's default
// sourceExts; registering it as an asset extension makes Metro bundle CommonJS
// entry points (e.g. superstruct's dist/index.cjs, a dependency of
// @react-native-firebase/analytics) as static assets instead of code, so their
// exports resolve to undefined and the app crashes at startup.
config.resolver.assetExts.push('wasm')

config.watchFolders = [...(config.watchFolders ?? []), path.resolve(__dirname, 'shared')]

config.server = {
  ...config.server,
  enhanceMiddleware: (middleware) => {
    return (req, res, next) => {
      // Required for Firebase OAuth popup flows. This intentionally uses
      // `same-origin-allow-popups`, which trades off full cross-origin isolation
      // (and can affect features like SharedArrayBuffer) so auth popups work.
      res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless')
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups')
      middleware(req, res, next)
    }
  },
}

module.exports = config
