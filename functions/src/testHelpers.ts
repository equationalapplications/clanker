import admin from "firebase-admin";

export type FetchCall = {
  url: string;
  body: string;
};

export type GetUserStub = (uid: string) => Promise<{email?: string}>;

export type FetchResponder = (
  url: string,
  init: RequestInit | undefined,
  calls: FetchCall[]
) => Promise<Response>;

/**
 * General-purpose helper for stubbing partial admin.auth() implementation.
 * Safely shadows and restores the admin.auth function for the test scope.
 */
export async function withAdminAuthPartialStub<T>(
  authPartial: Partial<ReturnType<typeof admin.auth>>,
  run: () => Promise<T>
): Promise<T> {
  const hadOwnAuth = Object.prototype.hasOwnProperty.call(admin, "auth");
  const ownAuthDescriptor = hadOwnAuth ? Object.getOwnPropertyDescriptor(admin, "auth") : undefined;

  Object.defineProperty(admin, "auth", {
    value: (() => authPartial) as typeof admin.auth,
    writable: true,
    configurable: true,
  });

  try {
    return await run();
  } finally {
    if (ownAuthDescriptor) {
      Object.defineProperty(admin, "auth", ownAuthDescriptor);
    } else {
      // Remove temporary shadow so prototype getter is used again.
      delete (admin as Record<string, unknown>).auth;
    }
  }
}

/**
 * Convenience wrapper: stubs admin.auth() with just getUser.
 * Equivalent to withAdminAuthPartialStub({getUser}, run).
 */
export async function withAdminAuthStub<T>(
  getUser: GetUserStub,
  run: () => Promise<T>
): Promise<T> {
  return withAdminAuthPartialStub({getUser} as Partial<ReturnType<typeof admin.auth>>, run);
}

export async function withFetchStub<T>(
  responder: FetchResponder,
  run: (calls: FetchCall[]) => Promise<T>
): Promise<T> {
  const originalFetch = globalThis.fetch;
  const calls: FetchCall[] = [];

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      body: typeof init?.body === "string" ? init.body : "",
    });

    return responder(url, init, calls);
  }) as typeof fetch;

  try {
    return await run(calls);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

export async function withAdminAuthAndFetchStubs<T>(
  getUser: GetUserStub,
  responder: FetchResponder,
  run: (calls: FetchCall[]) => Promise<T>
): Promise<T> {
  return withAdminAuthStub(getUser, () => withFetchStub(responder, run));
}