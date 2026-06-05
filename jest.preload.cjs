// Preload: runs BEFORE any other module is loaded in the Node.js process.
// Defines __DEV__ which react-native/index.js and expo-modules-core expect
// as a bare global (not just globalThis) in strict-mode CJS modules.
global.__DEV__ = true