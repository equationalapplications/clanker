module.exports = function (api) {
  api.cache(true)

  const isTest = process.env.NODE_ENV === 'test'

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
