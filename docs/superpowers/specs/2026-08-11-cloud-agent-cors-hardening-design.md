# cloud-agent Cross-Origin Hardening Design

**Date:** 2026-08-11
**Status:** Implemented
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

### Why no existing client breaks

- **The native app uses React Native WebSocketModule, which sends an `Origin` header.** RN 0.86.2's Android `WebSocketModule` calls `getDefaultOrigin(url)` to synthesize `Origin: https://<endpoint>` when the JS client invokes `new WebSocket(url)` without one (see `node_modules/react-native/ReactAndroid/src/main/java/com/facebook/react/modules/websocket/WebSocketModule.kt:387-410`). The mobile app's two native call sites (`src/services/cloudAgentService.ts:166` and `src/machines/liveVoiceMachine.ts:570`) use exactly that form. The cloud-agent accepts the request's own origin on the upgrade handler unconditionally, so the synthesized origin — equal to the cloud-agent's own HTTPS origin — passes without any `CORS_ORIGIN` configuration. Same-origin browsers pass for the same reason.
- **The production web client must be allowlisted.** `app.config.ts:182-188` configures the web bundler/build, and that build **is** deployed to production: `firebase.json` defines hosting site `clanker-prod` serving `dist/`, reachable at `https://clanker-ai.com`. That page calls the cloud-agent at its Cloud Run origin (`shared/localCloudAgent.ts:39`), so every one of its requests is cross-origin and is denied unless `CORS_ORIGIN` lists it. `cloud-agent/scripts/deploy.sh` sets that list on every deploy. The local-dev case is covered by the explicit allowlist below.
- **Local Expo web is explicitly allowlisted.** `docker-compose.local.yml:24` sets `CORS_ORIGIN=http://localhost:8081,http://localhost:8082`, so local web development remains supported.
- **The MV3 Desktop Bridge is a browser client, but its production rollout is deferred.** Its service worker uses authenticated `fetch` and WebSocket calls from a `chrome-extension://<extension-id>` origin. The parser preserves that non-HTTP origin when it is explicitly configured, but production remains default-deny until the extension has a stable published ID and the corresponding `CORS_ORIGIN` value is deliberately configured.

## Goals

- `corsOrigins()` denies cross-origin browser access by default.
- WebSocket upgrades enforce the same allowlist as HTTP, sharing one source of truth.
- Explicitly configured `chrome-extension://` origins survive normalization and work over both HTTP and WebSocket.
- No behavior change for native clients, server-to-server callers, or local Expo web dev.
- Code scanning alert #26 resolved.

## Non-Goals

- Changing the authentication model. Bearer tokens stay.
- Enabling `credentials` on the CORS middleware.
- Adding a production web client.
- Configuring the production Desktop Bridge origin before the extension has a stable published ID.
- Rate limiting, payload limits, or any other hardening not in this class.

## Design

### 1. HTTP: default-deny

The default and parser change in `corsOrigins()` is intentionally small:

```ts
function corsOrigins(): string | string[] | boolean {
  const raw = process.env.CORS_ORIGIN
  // No env var → deny all cross-origin browser access. Browser clients must
  // opt in through an explicit allowlist.
  if (!raw) return false
  // ... allowlist parsing below
}
```

The existing comma splitting, trimming, `'*'` filter, and `false` fallback remain. HTTP(S) entries still normalize through `new URL(value).origin`. Explicit `chrome-extension://` entries bypass `.origin` and stay as trimmed literals (with one trailing slash removed), because Node represents their opaque URL origin as the string `"null"`, which could never match the browser's actual `Origin` header.

```ts
.map((value) => {
  if (value.toLowerCase().startsWith('chrome-extension://')) {
    return value.replace(/\/$/, '')
  }
  try {
    return new URL(value).origin
  } catch {
    return value.replace(/\/$/, '')
  }
})
```

Note that `origin: false` omits the `Access-Control-Allow-Origin` header entirely. It does **not** cause the server to reject the request — a non-browser client (curl, native fetch, another service) is unaffected, because enforcement lives in the browser. This is the correct and intended semantic: we stop granting permission, we do not start blocking traffic.

### 2. WebSocket: origin verification on upgrade

Add a helper beside `corsOrigins()` that derives the server's own origin from the upgrade request, plus an `isAllowedWsOrigin` that accepts either no origin (server-to-server callers), the request's own origin (React Native synthesized origin and same-origin browsers), or an explicitly allowlisted origin:

```ts
export function selfOrigin(req: {
  headers: { host?: string }
  socket: { encrypted?: boolean }
}): string | null {
  const host = req.headers.host
  if (!host) return null
  const scheme = req.socket.encrypted ? 'https' : 'http'
  return `${scheme}://${host}`
}

export function isAllowedWsOrigin(origin: string | undefined, self: string | null): boolean {
  // Native clients and server-to-server callers send no Origin header. They are
  // not browsers, so the same-origin model does not apply to them; they are
  // gated by bearer-token auth inside the individual upgrade handlers.
  if (!origin) return true

  // See `selfOrigin` — the request's own origin is always allowed.
  if (self && origin === self) return true

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
  if (!isAllowedWsOrigin(req.headers.origin, selfOrigin(req))) {
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
    return
  }
  const pathname = new URL(req.url ?? '', `http://${req.headers.host}`).pathname
  // ... existing dispatch unchanged
})
```

`socket.end(...)` flushes the complete 403 response and then closes the connection. `Connection: close` states the intent to proxies and `Content-Length: 0` makes the response framing explicit; a separate immediate `socket.destroy()` would risk aborting buffered response bytes before the client receives the status.

`isAllowedWsOrigin` and `selfOrigin` must be **exported** from `index.ts`, and so must whatever function builds the HTTP server with its upgrade handler attached. The testing section below depends on both.

**Resulting behavior matrix:**

| `Origin` header                                      | `CORS_ORIGIN`             | Outcome                                                            |
| ---------------------------------------------------- | ------------------------- | ------------------------------------------------------------------ |
| absent                                               | any                       | **allow** — server-to-server client                                |
| matches the cloud-agent's own origin (host + scheme) | unset                     | **allow** — same-origin browser or React Native synthesized origin |
| matches an allowlisted HTTP(S) origin                | set                       | **allow**                                                          |
| an explicitly configured `chrome-extension://<id>`   | set                       | **allow** — preserved as a literal origin                          |
| any other origin                                     | unset                     | **reject 403**                                                     |
| any other origin                                     | set, but not in allowlist | **reject 403**                                                     |
| any origin                                           | `*` only                  | **reject 403** — wildcard already filtered to `false`              |

Sharing `corsOrigins()` is the point of the design: HTTP and WebSocket policy cannot drift apart, and a future allowlist entry applies to both automatically. The `self` short-circuit is the separate escape hatch for native clients, who cannot forge a synthesized origin to a different host.

### Why the `!origin → allow` and `self → allow` rules are sound

Both look like bypasses. Neither is.

- **No `Origin` header.** A hostile non-browser client can simply omit `Origin`. That is true and irrelevant. Origin checking exists to constrain **browsers**, which always send `Origin` on a WebSocket upgrade and cannot forge it from page JavaScript. A non-browser attacker was never constrained by the same-origin model in the first place; what stops them is the bearer token each upgrade handler verifies. Rejecting header-less upgrades would break every legitimate server-to-server caller while stopping no attacker.
- **Matches the cloud-agent's own origin.** React Native 0.86.2 synthesizes the request's own origin as a hardware-default behavior — there is no application code that opts into it, and no application code that can override it without a per-platform native module. Same-origin browsers, by definition, also send the server's own origin. Neither caller can synthesize a _different_ host: the constructed value is a function of the WS URL, which the attacker controls but only to point at their own malicious server (`wss://evil.example.com` does not get `Origin: https://api.clanker.example` from `getDefaultOrigin`). What stops the true cross-origin attack — a browser at `https://evil.example.com` opening `wss://api.clanker.example/agent/stream` — is that the browser sends `Origin: https://evil.example.com`, not `https://api.clanker.example`. The matcher therefore rejects the only case it actually needs to reject.

## Testing

All in `cloud-agent/src/index.test.ts`, which already has a CORS section.

### Framework constraint — read before writing any test

**This suite is `node:test`, not Jest.** `cloud-agent/package.json` has **no Jest dependency**; its test script is:

```bash
NODE_ENV=test npm run build && NODE_ENV=test node --test --test-reporter spec "dist/**/*.test.js"
```

The existing file imports `test` from `node:test` and `assert` from `node:assert/strict`, and uses strict `assert.*` calls with zero `expect(`. Any test written with `describe`/`beforeAll`/`afterAll`/`expect().toBe()`/`done`-callbacks will not run. `node:test` provides no `expect`, and its async model is promises rather than `done` callbacks. Note also that the package is `"type": "module"` and tests execute from compiled `dist/`, so imports carry `.js` extensions.

### Modified (1)

`'health endpoint reflects origin when CORS_ORIGIN is not set'` (line 149) asserts the permissive behavior and inverts. Rename to `'health endpoint blocks all origins when CORS_ORIGIN is not set'` and assert `res.headers['access-control-allow-origin']` is `undefined`.

Its existing cleanup is correct and needs no change: the test deletes `CORS_ORIGIN` at the start, so when the original value was `undefined` the correct end state is "deleted", which is what the `if (orig !== undefined)` restore produces. The three tests above it need an explicit `delete` branch only because they _set_ a value; this one does not.

### Unchanged (3)

The allowlisted-origin, preflight, and wildcard-rejection tests already cover the good paths and must keep passing untouched — they are the regression net proving the allowlist still works.

### New HTTP normalization coverage (1)

An explicitly configured `chrome-extension://abcdefghijklmnop` origin receives the matching `Access-Control-Allow-Origin` header. This exercises the real `cors` middleware and proves the parser did not collapse the configured value to `"null"`.

### New WebSocket coverage (6) — the upgrade matrix

1. Upgrade with no `Origin` header succeeds (server-to-server caller path).
2. Upgrade with an `Origin` and no `CORS_ORIGIN` is rejected with 403.
3. Upgrade with an allowlisted HTTP(S) `Origin` succeeds.
4. Upgrade with an explicitly configured `chrome-extension://` origin succeeds.
5. Upgrade with a non-allowlisted `Origin` is rejected with 403.
6. Upgrade with the cloud-agent's own origin (the `Origin` React Native's `WebSocketModule` synthesizes, and a same-origin browser sends) succeeds without any `CORS_ORIGIN` configuration. This is the production mobile-app path and was the regression that earlier review comments missed.

Two requirements govern how these are written:

**Drive the real server, never a re-implementation.** `supertest` cannot perform WebSocket upgrades, so these need a real listener on an ephemeral port (`server.listen(0)`). Bind **the actual exported server factory from `index.ts`**, with its real `server.on('upgrade')` handler attached. Standing up a fresh `http.createServer()` in the test file and re-implementing the origin check inline would assert that a _copy_ of the logic works while leaving the production handler completely unexercised — the tests would keep passing after a regression in the real code, which is worse than having no tests, because it reads as coverage.

**Use a raw `http.request`, not a `ws` client.** These five assertions only distinguish 403 from a successful upgrade, so issue a plain `http.request` with `Upgrade: websocket` and `Connection: Upgrade` headers and assert on the status: listen for the `upgrade` event for success cases and the `response` event for the 403 cases. Driving them through a `ws` client instead means the client computes and validates `Sec-WebSocket-Accept`, which races the assertion and makes the happy-path tests flaky for reasons unrelated to what they test.

Since `CORS_ORIGIN` is read per-upgrade by `isAllowedWsOrigin` (unlike the HTTP path, where `corsOrigins()` is evaluated once at `createApp` time), these tests may set and clear the env var around each request without rebuilding the server. Save and restore it per test in the style the existing CORS tests use.

### Baselines

Existing suite before this hardening work was 281 tests (280 pass, 1 skipped). With the six upgrade cases plus the HTTP and WebSocket Chrome-extension regressions, the target is 288 total (287 pass, 1 skipped).

## Rollout

Low risk for the native app and server-to-server callers: they send no `Origin`, or an `Origin` equal to the service's own. **Breaking for the production web client unless `CORS_ORIGIN` is configured** — see the incident note below. Local Expo web already has an allowlist. The Desktop Bridge source targets the production cloud-agent, but its production rollout remains deferred until it has a stable published extension ID and that exact `chrome-extension://<id>` value is configured.

1. Merge to `staging` per [CONTRIBUTING.md](../../../CONTRIBUTING.md) — PRs target `staging`, which is later promoted to `main`.
2. Deploy cloud-agent. There is no live staging environment, so this deploy lands in production; treat the verification below as gating rather than as a post-hoc check.
3. Verify `/health` returns 200; the mobile app's chat, streaming, and live-voice paths still connect; **and** the web client at `https://clanker-ai.com` can run a chat turn and open a Talk session. The web paths are the ones this change can break.
4. If the web paths fail, roll traffic back to the previous Cloud Run revision (`gcloud run services update-traffic`) rather than waiting on a fix-forward.
5. Confirm alert #26 auto-closes on the next CodeQL run against `main`.

**Rollback:** shift Cloud Run traffic back to the previous revision, or revert the commit. There is no data migration and no coupling to the dependency work in the sibling spec. There _is_ a config change — the `CORS_ORIGIN` env var — but it is additive and safe to leave set across a revert, since the pre-hardening `corsOrigins()` ignores the variable's absence rather than its presence.

**Required for this rollout:** `CORS_ORIGIN` **must** be set in Cloud Run to the production web-client origins. `cloud-agent/scripts/deploy.sh` now supplies them by default, so a deploy through that script is self-contained; a deploy by any other path must set the variable explicitly. The native app and server-to-server callers need no configuration — the native app's synthesized origin matches the cloud-agent's own HTTP(S) origin and is accepted by the upgrade guard. Local Expo web development is covered by `docker-compose.local.yml:24`. Before the Desktop Bridge is published for production, add the stable `chrome-extension://<id>` origin to the same list and verify both the HTTP and WebSocket paths; that addition remains deferred until the extension ID exists.

### 2026-08-11 production incident

The first production deploy of this change omitted `CORS_ORIGIN` because this document originally asserted no value was needed — an assertion that rested on the incorrect claim that no production web client existed. Result: `/agent/stream` and `/agent/live` returned 403 to the web app (surfacing as "WebSocket connection error" in Talk) and `/agent/run` responses carried no `Access-Control-Allow-Origin` (surfacing as a failure in Chat's web-search grounding). Traffic was rolled back to the previous Cloud Run revision. The native mobile app was never affected, exactly as this document predicted. The code was correct; the deployment configuration and this document's threat model were not.

## Open Questions

None. Scope, behavior, and test plan are settled.

## Related

- [2026-08-11 Dependency Security and Major Upgrades](./2026-08-11-dependency-security-and-major-upgrades-design.md) — sibling security effort, independent; shares no files.
