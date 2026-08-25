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
    ignores: ['src/services/photoLibrarySaver.ts', 'src/services/__tests__/**'],
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
