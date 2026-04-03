/**
 * Platform-specific key-value storage — native implementation.
 * Re-exports expo-sqlite/kv-store which uses SQLite under the hood.
 * On web, the bundler resolves kvStorage.web.ts instead.
 */
export { default as Storage } from 'expo-sqlite/kv-store'
