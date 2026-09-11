// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config')
const expoConfig = require('eslint-config-expo/flat')
const reactCompiler = require('eslint-plugin-react-compiler')

// Both patterns are defined once and shared. `no-restricted-imports` is not
// merged across flat-config objects — the last object matching a file replaces
// the rule wholesale — so the exemption block below has to re-state every
// pattern it still wants enforced. Sharing the objects keeps the two lists from
// drifting apart.
const EXPO_MEDIA_LIBRARY_PATTERN = {
  group: ['expo-media-library', 'expo-media-library/*'],
  message:
    'expo-media-library crashes the web bundle at import time (native module, no web implementation). Import it only inside src/services/photoLibrarySaver.ts.',
}

const REACT_NATIVE_FIREBASE_PATTERN = {
  group: ['@react-native-firebase/*'],
  message:
    "@react-native-firebase maintains a native-only app registry, separate from the web SDK's. In the web bundle it is empty, so getApp() throws \"No Firebase App '[DEFAULT]' has been created\" at import time and takes down every route. Take the callable from ~/config/firebaseConfig (the platform seam), or import this package only from a module that has a .web.ts twin.",
}

const EXPO_SHARING_PATTERN = {
  // The bare name and the recursive subpath pattern are both required:
  // `no-restricted-imports` patterns use gitignore-style globs and a bare
  // module name like `expo-sharing` only matches the package root. A
  // subpath like `expo-sharing/build/Sharing` would otherwise slip past
  // the guard and reach the web bundle with the same raw-URL shape.
  group: ['expo-sharing', 'expo-sharing/**'],
  message:
    "expo-sharing's web build posts the raw URL instead of file bytes, so sharing a Storage URL from shared code hands the target an expiring, tokenized link. Share image bytes through ~/services/imageSharer (the platform seam); okfSave.ts is the other exempted native-path consumer.",
}

module.exports = defineConfig([
  expoConfig,
  reactCompiler.configs.recommended,
  {
    ignores: ['dist/*', 'web-build/*', 'build-*.ipa', 'functions/*'],
  },
  {
    // Both guarded packages break the web bundle at IMPORT time, which no test
    // gate can catch: Jest resolves platform-seamed specifiers to the native
    // twin, and tsc never sees Metro's resolution. These rules are the guard.
    //
    // `expo-media-library`'s main entry calls requireNativeModule at import
    // time with no web implementation. `@react-native-firebase/*` reads a
    // native app registry that is empty on web. `expo-sharing` is not a
    // crash but a correctness trap: its web twin shares a raw URL, not the
    // fetched bytes.
    files: [
      'src/**/*.ts',
      'src/**/*.tsx',
      'app/**/*.ts',
      'app/**/*.tsx',
      'components/**/*.ts',
      'components/**/*.tsx',
      'lib/**/*.ts',
      'lib/**/*.tsx',
    ],
    // `src/services/__tests__/**` covers the seam's own suites (they import
    // the package under its real subpath to verify the native twin's behavior).
    // `src/components/__tests__/ChatImageBubble.test.tsx` is a second carve-out
    // on purpose: it has to mock + spy on `expo-media-library/legacy` because
    // Jest always resolves the bare `~/services/photoLibrarySaver` specifier
    // to the native .ts twin (jest-expo has no platform-suffix mapping), so the
    // test cannot reach the seam's behavior without touching the underlying
    // native module the seam depends on. Narrower-than-`src/**/__tests__/**`
    // is intentional: any OTHER test importing the package would mean a
    // production-code path was missed, which is exactly the regression this
    // rule exists to catch.
    ignores: [
      'src/services/photoLibrarySaver.ts',
      'src/services/imageSharer.ts',
      'src/services/__tests__/**',
      'src/components/__tests__/ChatImageBubble.test.tsx',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            EXPO_MEDIA_LIBRARY_PATTERN,
            EXPO_SHARING_PATTERN,
            REACT_NATIVE_FIREBASE_PATTERN,
          ],
        },
      ],
    },
  },
  {
    // The modules that may reach @react-native-firebase directly. Each is the
    // NATIVE half of a platform pair — a `.web.ts` twin exists beside it, so
    // Metro never resolves these files into the web bundle — plus the two auth
    // suites that assert against the native twin's behavior.
    //
    // `useBrowserActionApproval.ts` is the one entry here without a twin. It is
    // exempt because its `getAuth()` sits inside a callback rather than at
    // module scope, so it does not throw at import time the way the three
    // proactive services did; it is a known gap, not an endorsement, and it
    // should get a twin (or move to the seam) rather than stay on this list.
    //
    // These files stay subject to the expo-media-library and expo-sharing
    // patterns; only the @react-native-firebase pattern is lifted.
    files: [
      'src/config/firebaseConfig.ts',
      'src/auth/appleSignin.ts',
      'src/auth/googleSignin.ts',
      'src/auth/syncDisplayName.ts',
      'src/auth/__tests__/googleSignin.test.ts',
      'src/auth/__tests__/syncDisplayName.test.ts',
      'src/services/analyticsService.ts',
      'src/services/crashlyticsService.ts',
      'src/services/storageService.ts',
      'src/hooks/useBrowserActionApproval.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [EXPO_MEDIA_LIBRARY_PATTERN, EXPO_SHARING_PATTERN],
        },
      ],
    },
  },
  {
    // The one module that may reach `expo-sharing` directly: the OKF export
    // zips files in cache and hands the archive to the native share sheet —
    // a native-only path (the web export flow never imports this module).
    // It stays subject to the other two patterns; only expo-sharing is lifted.
    files: ['src/utilities/okfSave.ts', 'src/utilities/__tests__/okfSave.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [EXPO_MEDIA_LIBRARY_PATTERN, REACT_NATIVE_FIREBASE_PATTERN],
        },
      ],
    },
  },
])
