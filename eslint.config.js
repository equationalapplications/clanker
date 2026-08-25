// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config')
const expoConfig = require('eslint-config-expo/flat')
const reactCompiler = require('eslint-plugin-react-compiler')

module.exports = defineConfig([
  expoConfig,
  reactCompiler.configs.recommended,
  {
    ignores: ['dist/*', 'web-build/*', 'build-*.ipa', 'functions/*'],
  },
  {
    // `expo-media-library`'s main entry calls requireNativeModule at import
    // time with no web implementation, so any import reachable from the web
    // bundle crashes clanker-ai.com at load. Jest resolves platform-seamed
    // specifiers to the native twin and tsc never sees Metro's resolution, so
    // no test gate would catch a reintroduction — this rule is the guard.
    files: ['src/**/*.ts', 'src/**/*.tsx'],
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
      'src/services/__tests__/**',
      'src/components/__tests__/ChatImageBubble.test.tsx',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['expo-media-library', 'expo-media-library/*'],
              message:
                'expo-media-library crashes the web bundle at import time (native module, no web implementation). Import it only inside src/services/photoLibrarySaver.ts.',
            },
          ],
        },
      ],
    },
  },
])
