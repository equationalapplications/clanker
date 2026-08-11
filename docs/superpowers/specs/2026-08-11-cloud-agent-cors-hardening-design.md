# cloud-agent Cross-Origin Hardening Design

**Date:** 2026-08-11
**Status:** Approved, not implemented
**Owner:** equationalapplications
**Closes:** [Code scanning alert #26](https://github.com/equationalapplications/clanker/security/code-scanning/26) (`js/cors-permissive-configuration`, medium)

## Problem

`corsOrigins()` in `cloud-agent/src/index.ts:122` returns `true` when the `CORS_ORIGIN` environment variable is unset:

```ts
const raw = process.env.CORS_ORIGIN
// No env var → reflect the request Origin (allow all). Safe because auth uses
// Authorization header (not cookies), so credentials are not at risk.
if (!raw) return true
```

`origin: true` makes the `cors` middleware echo whatever `Origin` the caller sent back as `Access-Control-Allow-Origin`. Production Cloud Run does not set `CORS_ORIGIN`, so **production runs fully permissive**. CodeQL flags this at `index.ts:154`, the `app.use(cors(...))` call site.

A second, unflagged instance of the same class exists: the four WebSocket endpoints registered in `server.on('upgrade')` (`index.ts:425`) perform **no `Origin` validation at all**. CORS does not govern WebSocket upgrades, so the HTTP fix does not cover them.

### Actual severity

Lower than the alert implies, but the fix is still correct.

The existing code comment is accurate as far as it goes: authentication is a bearer token in the `Authorization` header, and `credentials` is not enabled on the middleware. A malicious cross-origin page therefore cannot induce a browser to attach a victim's credentials, so this is **not** an exploitable CSRF today.

What it actually is:

1. A standing permission grant with no consumer. It becomes exploitable the moment anything cookie-based, session-based, or origin-trusting is introduced — and that change would not obviously look security-relevant to whoever makes it.
2. A defect that every scanner will keep reporting, costing triage time on each run.

The same reasoning applies to the WebSocket upgrade paths: safe today because of bearer-token auth, fragile for the same reason.

### Why no client breaks

- **There is no web target.** No `web` platform in the app config and no web build in any CI workflow. The client is React Native on native platforms, which is not subject to CORS.
- **The only browser origin is local dev.** `docker-compose.local.yml:24` already sets `CORS_ORIGIN=http://localhost:8081,http://localhost:8082` for local Expo web, and that path is unaffected.
- **Native clients send no `Origin` header**, so the WebSocket rule below never rejects them.

## Goals

- `corsOrigins()` denies cross-origin browser access by default.
- WebSocket upgrades enforce the same allowlist as HTTP, sharing one source of truth.
- No behavior change for native clients, server-to-server callers, or local Expo web dev.
- Code scanning alert #26 resolved.

## Non-Goals

- Changing the authentication model. Bearer tokens stay.
- Enabling `credentials` on the CORS middleware.
- Adding a production web client or any production `CORS_ORIGIN` value.
- Rate limiting, payload limits, or any other hardening not in this class.

## Design

### 1. HTTP: default-deny

One-line change in `corsOrigins()`:

```ts
function corsOrigins(): string | string[] | boolean {
  const raw = process.env.CORS_ORIGIN
  // No env var → deny all cross-origin browser access. The only clients today
  // are the Expo mobile app and server-to-server callers, neither of which is
  // subject to CORS; a browser-based client must opt in via an explicit allowlist.
  if (!raw) return false
  // ... existing allowlist parsing unchanged
}
```

Everything below the early return is already correct and stays as-is: comma splitting, trimming, URL normalization to `.origin`, the `'*'` filter, and the `false` fallback when the allowlist is empty after filtering.

Note that `origin: false` omits the `Access-Control-Allow-Origin` header entirely. It does **not** cause the server to reject the request — a non-browser client (curl, native fetch, another service) is unaffected, because enforcement lives in the browser. This is the correct and intended semantic: we stop granting permission, we do not start blocking traffic.

### 2. WebSocket: origin verification on upgrade

Add a helper beside `corsOrigins()`:

```ts
function isAllowedWsOrigin(origin: string | undefined): boolean {
  // Native clients and server-to-server callers send no Origin header. They are
  // not browsers, so the same-origin model does not apply to them; they are
  // gated by bearer-token auth inside the individual upgrade handlers.
  if (!origin) return true

  const allowed = corsOrigins()
  if (allowed === false) return false
  if (allowed === true) return true // unreachable today; guards future changes
  const list = Array.isArray(allowed) ? allowed : [allowed]
  return list.includes(origin)
}
```

Applied at the top of the existing `server.on('upgrade')` handler, before any path dispatch, so a rejected origin never reaches `handleUpgrade` and never allocates a socket:

```ts
server.on('upgrade', (req, socket, head) => {
  if (!isAllowedWsOrigin(req.headers.origin)) {
    socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
    socket.destroy()
    return
  }
  const pathname = new URL(req.url ?? '', `http://${req.headers.host}`).pathname
  // ... existing dispatch unchanged
})
```

`Connection: close` is included because the socket is destroyed immediately after. It is not strictly required — the destroy ends the connection either way — but it states the intent explicitly for any proxy or intermediary sitting between the client and Cloud Run, rather than leaving them to infer it from a dropped socket.

`isAllowedWsOrigin` must be **exported** from `index.ts`, and so must whatever function builds the HTTP server with its upgrade handler attached. The testing section below depends on both.

**Resulting behavior matrix:**

| `Origin` header | `CORS_ORIGIN` | Outcome |
|---|---|---|
| absent | any | **allow** — native/server client |
| present | unset | **reject 403** |
| present, allowlisted | set | **allow** |
| present, not allowlisted | set | **reject 403** |
| present | `*` only | **reject 403** — wildcard already filtered to `false` |

Sharing `corsOrigins()` is the point of the design: HTTP and WebSocket policy cannot drift apart, and a future allowlist entry applies to both automatically.

### Why the `!origin → allow` rule is sound

It looks like a bypass — a hostile non-browser client can simply omit `Origin`. That is true and irrelevant. Origin checking exists to constrain **browsers**, which always send `Origin` on a WebSocket upgrade and cannot forge it from page JavaScript. A non-browser attacker was never constrained by the same-origin model in the first place; what stops them is the bearer token each upgrade handler verifies. Rejecting header-less upgrades would break every legitimate native client while stopping no attacker.

## Testing

All in `cloud-agent/src/index.test.ts`, which already has a CORS section.

### Framework constraint — read before writing any test

**This suite is `node:test`, not Jest.** `cloud-agent/package.json` has **no Jest dependency**; its test script is:

```
NODE_ENV=test npm run build && NODE_ENV=test node --test --test-reporter spec "dist/**/*.test.js"
```

The existing file imports `test` from `node:test` and `assert` from `node:assert/strict`, and contains 44 `assert.*` calls and zero `expect(`. Any test written with `describe`/`beforeAll`/`afterAll`/`expect().toBe()`/`done`-callbacks will not run. `node:test` provides no `expect`, and its async model is promises rather than `done` callbacks. Note also that the package is `"type": "module"` and tests execute from compiled `dist/`, so imports carry `.js` extensions.

### Modified (1)

`'health endpoint reflects origin when CORS_ORIGIN is not set'` (line 149) asserts the permissive behavior and inverts. Rename to `'health endpoint blocks all origins when CORS_ORIGIN is not set'` and assert `res.headers['access-control-allow-origin']` is `undefined`.

Its existing cleanup is correct and needs no change: the test deletes `CORS_ORIGIN` at the start, so when the original value was `undefined` the correct end state is "deleted", which is what the `if (orig !== undefined)` restore produces. The three tests above it need an explicit `delete` branch only because they *set* a value; this one does not.

### Unchanged (3)

The allowlisted-origin, preflight, and wildcard-rejection tests already cover the good paths and must keep passing untouched — they are the regression net proving the allowlist still works.

### New (4) — the upgrade matrix

1. Upgrade with no `Origin` header succeeds (native client path).
2. Upgrade with an `Origin` and no `CORS_ORIGIN` is rejected with 403.
3. Upgrade with an allowlisted `Origin` succeeds.
4. Upgrade with a non-allowlisted `Origin` is rejected with 403.

Two requirements govern how these are written:

**Drive the real server, never a re-implementation.** `supertest` cannot perform WebSocket upgrades, so these need a real listener on an ephemeral port (`server.listen(0)`). Bind **the actual exported server factory from `index.ts`**, with its real `server.on('upgrade')` handler attached. Standing up a fresh `http.createServer()` in the test file and re-implementing the origin check inline would assert that a *copy* of the logic works while leaving the production handler completely unexercised — the tests would keep passing after a regression in the real code, which is worse than having no tests, because it reads as coverage.

**Use a raw `http.request`, not a `ws` client.** These four assertions only distinguish 403 from a successful upgrade, so issue a plain `http.request` with `Upgrade: websocket` and `Connection: Upgrade` headers and assert on the status: listen for the `upgrade` event for success cases and the `response` event for the 403 cases. Driving them through a `ws` client instead means the client computes and validates `Sec-WebSocket-Accept`, which races the assertion and makes the happy-path tests flaky for reasons unrelated to what they test.

Since `CORS_ORIGIN` is read per-upgrade by `isAllowedWsOrigin` (unlike the HTTP path, where `corsOrigins()` is evaluated once at `createApp` time), these tests may set and clear the env var around each request without rebuilding the server. Save and restore it per test in the style the existing CORS tests use.

### Baselines

Existing suite is 281 tests (280 pass, 1 skipped) via `npm test` in `cloud-agent/`. Target after this change: 285.

## Rollout

Low risk. No production client sends an `Origin` header to this service, so the observable production change is zero.

1. Merge to `staging` per [CONTRIBUTING.md](../../../CONTRIBUTING.md) — PRs target `staging`, which is later promoted to `main`.
2. Deploy cloud-agent to staging. Verify `/health` returns 200 and the mobile app's chat, streaming, and live-voice paths all still connect.
3. Promote to production.
4. Confirm alert #26 auto-closes on the next CodeQL run against `main`.

**Rollback:** revert the commit. There is no data migration, no config change, and no coupling to the dependency work in the sibling spec.

**Explicitly not required:** no `CORS_ORIGIN` value needs to be set in Cloud Run for staging or production. Leaving it unset *is* the hardened configuration. Setting it would be the change that needs justification.

## Open Questions

None. Scope, behavior, and test plan are settled.

## Related

- [2026-08-11 Dependency Security and Major Upgrades](./2026-08-11-dependency-security-and-major-upgrades-design.md) — sibling security effort, independent; shares no files.
