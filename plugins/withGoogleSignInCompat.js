// JS twin of withGoogleSignInCompat.ts (kept in sync; see the .ts file for
// the rationale). Expo loads whichever resolves for the loader in use.
const pluginModule = require('@react-native-google-signin/google-signin/app.plugin.js')
const withGoogleSignInRoot = pluginModule.default ?? pluginModule

module.exports = function withGoogleSignInCompat(config) {
  return withGoogleSignInRoot(config, undefined)
}
