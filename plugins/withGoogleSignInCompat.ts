// google-signin 16.2+ discriminates on its `options` argument: any truthy
// value selects the "without Firebase config plugin" path, which demands a
// hardcoded `iosUrlScheme` and throws otherwise — including the options
// object this app used to pass (`{ iosUrlScheme:
// process.env.EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME }` reads as `{}` when the env
// var is unset, e.g. a local prebuild without .env loaded). This app wires
// the Firebase config file (ios.googleServicesFile), so force the Firebase
// path by always calling the plugin root with `options === undefined`; the
// URL scheme is then derived from GoogleService-Info.plist's
// REVERSED_CLIENT_ID. See __tests__/withGoogleSignInCompat.test.ts.
import type { ConfigPlugin } from '@expo/config-plugins'

import withGoogleSignInRoot from '@react-native-google-signin/google-signin/app.plugin.js'

const withGoogleSignInCompat: ConfigPlugin = (config) => withGoogleSignInRoot(config, undefined)

export default withGoogleSignInCompat
