import { services, __setAuthForTest } from './firebaseAdmin.js'
import type { Auth } from 'firebase-admin/auth'

export type FetchCall = {
  url: string
  body: string
}

export type GetUserStub = (uid: string) => Promise<{ email?: string }>

export type FetchResponder = (
  url: string,
  init: RequestInit | undefined,
  calls: FetchCall[],
) => Promise<Response>

/**
 * General-purpose helper for stubbing partial services.auth implementation.
 * Safely shadows and restores the cached services.auth instance for the test scope.
 */
export async function withAdminAuthPartialStub<T>(
  authPartial: Partial<Auth>,
  run: () => Promise<T>,
): Promise<T> {
  const originalAuth = services.auth
  __setAuthForTest(authPartial as Auth)

  try {
    return await run()
  } finally {
    __setAuthForTest(originalAuth)
  }
}

/**
 * Convenience wrapper: stubs services.auth with just getUser.
 * Equivalent to withAdminAuthPartialStub({getUser}, run).
 */
export async function withAdminAuthStub<T>(
  getUser: GetUserStub,
  run: () => Promise<T>,
): Promise<T> {
  return withAdminAuthPartialStub({ getUser } as Partial<Auth>, run)
}

export async function withFetchStub<T>(
  responder: FetchResponder,
  run: (calls: FetchCall[]) => Promise<T>,
): Promise<T> {
  const originalFetch = globalThis.fetch
  const calls: FetchCall[] = []

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    calls.push({
      url,
      body: typeof init?.body === 'string' ? init.body : '',
    })

    return responder(url, init, calls)
  }) as typeof fetch

  try {
    return await run(calls)
  } finally {
    globalThis.fetch = originalFetch
  }
}

export async function withAdminAuthAndFetchStubs<T>(
  getUser: GetUserStub,
  responder: FetchResponder,
  run: (calls: FetchCall[]) => Promise<T>,
): Promise<T> {
  return withAdminAuthStub(getUser, () => withFetchStub(responder, run))
}
