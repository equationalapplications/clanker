const config = require('./package.json').jest
module.exports = {
  preset: config.preset,
  setupFiles: config.setupFiles,
  transformIgnorePatterns: config.transformIgnorePatterns,
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/functions/', '<rootDir>/\\.claude/', '<rootDir>/\\.worktrees/', '<rootDir>/build/', '<rootDir>/dist/', '<rootDir>/coverage/', '<rootDir>/__tests__/helpers/'],
  testRegex: '.*\\.int\\.test\\.ts$',
}