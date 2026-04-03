// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);

// Prevent Metro from crawling the Firebase Functions directory.
// Functions are a separate Node.js runtime and must not be bundled into the app.
config.resolver.blockList = [
  ...(Array.isArray(config.resolver.blockList)
    ? config.resolver.blockList
    : config.resolver.blockList
      ? [config.resolver.blockList]
      : []),
  new RegExp(path.resolve(__dirname, "functions") + "/.*"),
];

config.resolver.assetExts.push("cjs");
config.resolver.assetExts.push("wasm");

config.server = {
  ...config.server,
  enhanceMiddleware: (middleware) => {
    return (req, res, next) => {
      res.setHeader("Cross-Origin-Embedder-Policy", "credentialless");
      res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
      middleware(req, res, next);
    };
  },
};

module.exports = config;
