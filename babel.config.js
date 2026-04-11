module.exports = function (api) {
  api.cache.using(() => process.env.BABEL_ENV || process.env.NODE_ENV)

  const isTest = api.env('test')

  return {
    presets: ['babel-preset-expo'],
    plugins: [
      [
        'module-resolver',
        {
          alias: {
            '~': './src',
          },
        },
      ],
      // Tree-shaking plugin rewrites bare `react-native-paper` imports to deep
      // paths, which breaks jest.mock() in tests. Skip it in the test env.
      ...(isTest ? [] : ['react-native-paper/babel']),
      'react-native-reanimated/plugin', // Must be listed last
    ],
  }
}
