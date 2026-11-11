/**
 * Web stub for Crashlytics service.
 * Firebase JS SDK does not include Crashlytics, so all functions are no-ops.
 */

export async function initializeCrashlytics(_uid: string | null = null): Promise<void> {}

export async function setCrashlyticsEnabled(_enabled: boolean): Promise<void> {}

export async function setCrashlyticsUserId(_userId: string | null): Promise<void> {}

export async function clearCrashlyticsContext(): Promise<void> {}

export async function logCrashlyticsError(_error: Error, _context?: string): Promise<void> {}
