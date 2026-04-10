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

function restoreProperty(
  target: object,
  key: string,
  descriptor: PropertyDescriptor | undefined
): void {
  if (descriptor) {
    Object.defineProperty(target, key, descriptor);
  } else {
    delete (target as Record<string, unknown>)[key];
  }
}

export async function withAdminAuthStub<T>(
  getUser: GetUserStub,
  run: () => Promise<T>
): Promise<T> {
  const adminPrototype = Object.getPrototypeOf(admin);
  const originalAuthDescriptor = Object.getOwnPropertyDescriptor(adminPrototype, "auth");

  Object.defineProperty(adminPrototype, "auth", {
    configurable: true,
    value: () => ({getUser}),
  });

  try {
    return await run();
  } finally {
    restoreProperty(adminPrototype as object, "auth", originalAuthDescriptor);
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