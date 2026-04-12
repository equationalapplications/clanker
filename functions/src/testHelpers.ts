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

export async function withAdminAuthStub<T>(
  getUser: GetUserStub,
  run: () => Promise<T>
): Promise<T> {
  const hadOwnAuth = Object.prototype.hasOwnProperty.call(admin, "auth");
  const ownAuthDescriptor = hadOwnAuth ? Object.getOwnPropertyDescriptor(admin, "auth") : undefined;

  Object.defineProperty(admin, "auth", {
    value: (() => ({getUser})) as typeof admin.auth,
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