const { TRANSFORM_IGNORE_PATTERNS } = require('./jest.shared.config')

module.exports = {
  preset: 'jest-expo',
  setupFiles: ['<rootDir>/jest.setup.early.js', '<rootDir>/jest.setup.js'],
  transformIgnorePatterns: TRANSFORM_IGNORE_PATTERNS,
  testPathIgnorePatterns: [
    '/node_modules/',
    '<rootDir>/functions/',
    '<rootDir>/\\.claude/',
    '<rootDir>/\\.worktrees/',
    '<rootDir>/build/',
    '<rootDir>/dist/',
    '<rootDir>/coverage/',
    '<rootDir>/__tests__/helpers/',
  ],
  testRegex: '.*\\.int\\.test\\.ts$',
}
