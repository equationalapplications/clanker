module.exports = function (api) {
  api.cache(true)
  return {
    presets: ["babel-preset-expo"],
    // Reanimated plugin must be listed last
    plugins: ["react-native-reanimated/plugin"],
    env: {
      production: {
        plugins: ["react-native-paper/babel"],
      },
    },
  }
}
