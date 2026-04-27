/**
 * Global helpers injected by jest.setup.js for temporarily overriding
 * Platform.OS in test suites. Not available at runtime.
 */
declare function __setJestPlatformOS(os: string): void
declare function __resetJestPlatformOS(): void
