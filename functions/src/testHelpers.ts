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
  const adminWithAuth = admin as {auth: typeof admin.auth};
  const originalAuth = adminWithAuth.auth;

  adminWithAuth.auth = (() => ({getUser})) as typeof admin.auth;

  try {
    return await run();
  } finally {
    adminWithAuth.auth = originalAuth;
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