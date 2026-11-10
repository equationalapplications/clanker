declare module '@react-native-google-signin/google-signin/app.plugin.js' {
  import type { ConfigPlugin } from '@expo/config-plugins'

  // google-signin's plugin root: `options === undefined` selects the Firebase
  // config-file path; any truthy options demand a hardcoded iosUrlScheme.
  const withGoogleSignInRoot: ConfigPlugin<Record<string, string> | undefined>
  export default withGoogleSignInRoot
}
