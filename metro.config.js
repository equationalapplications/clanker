// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require("@expo/metro-config")

const defaultConfig = getDefaultConfig(__dirname)
defaultConfig.resolver.assetExts.push("cjs")
defaultConfig.resolver.assetExts.push('wasm');

defaultConfig.server = {
  ...defaultConfig.server,
  enhanceMiddleware: (middleware) => {
    return (req, res, next) => {
      res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      middleware(req, res, next);
    };
  }
};

module.exports = defaultConfig
