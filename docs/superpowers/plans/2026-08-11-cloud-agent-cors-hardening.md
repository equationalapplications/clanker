# cloud-agent Cross-Origin Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `cloud-agent` deny cross-origin browser access by default over both HTTP and WebSocket, closing code scanning alert #26 with zero observable production change.

**Architecture:** Two edits in one file. `corsOrigins()` in `cloud-agent/src/index.ts` flips its no-env-var default from `true` (reflect any Origin) to `false` (send no `Access-Control-Allow-Origin`). A new exported `isAllowedWsOrigin()` reuses `corsOrigins()` as the single source of truth and runs at the top of the existing `server.on('upgrade')` handler, rejecting disallowed browser origins with a raw `403` before any socket is allocated. Requests with no `Origin` header (every native and server-to-server client) are unaffected on both paths.

**Tech Stack:** TypeScript (ESM, `"type": "module"`), Express 5 + `cors`, `ws`, `node:test` + `node:assert/strict`, `supertest` for HTTP and raw `node:http` for upgrade tests.

**Spec:** [`docs/superpowers/specs/2026-08-11-cloud-agent-cors-hardening-design.md`](../specs/2026-08-11-cloud-agent-cors-hardening-design.md)

---

## Read this before writing any test

**`cloud-agent` uses `node:test`, not Jest.** There is no Jest dependency in `cloud-agent/package.json`. The test script is:

```
NODE_ENV=test npm run build && NODE_ENV=test node --test --test-reporter spec "dist/**/*.test.js"
```

Consequences you must respect:

- Import `test` from `node:test` and `assert` from `node:assert/strict`. There is no `expect`, no `describe`/`beforeAll`/`afterAll` convention in this file, and no `done` callback — async tests return promises.
- The package is ESM and tests run from compiled `dist/`, so **every relative import carries a `.js` extension** (`./index.js`, not `./index`).
- `npm test` rebuilds with `tsc` first. A TypeScript error fails the run before a single test executes.

## File Structure

- **Modify** `cloud-agent/src/index.ts`
  - `corsOrigins()` (line 122) — flip the default.
  - New exported `isAllowedWsOrigin()` — placed immediately after `corsOrigins()`, sharing its allowlist.
  - `attachWebSocketRoutes()` `server.on('upgrade')` (line 424) — guard clause at the top.
  - Already exported and needing no change: `createApp`, `attachWebSocketRoutes`.
- **Modify** `cloud-agent/src/index.test.ts`
  - Invert one existing CORS default test.
  - Add two module-scope test helpers (`startWsTestServer`, `attemptUpgrade`) and four upgrade tests.

No new files. No other package is touched.

---

## Task 1: HTTP default-deny

**Files:**
- Modify: `cloud-agent/src/index.ts:122-126`
- Test: `cloud-agent/src/index.test.ts:147-158`

- [ ] **Step 1: Invert the existing test so it fails**

In `cloud-agent/src/index.test.ts`, replace the whole test that currently reads:

```ts
test('health endpoint reflects origin when CORS_ORIGIN is not set', async () => {
  const orig = process.env.CORS_ORIGIN
  delete process.env.CORS_ORIGIN
  const db = makeMockDb()
  const app = createApp({ verifyToken: mockVerify, db, runAgentFn: mockRunAgent })
  const res = await request(app).get('/health').set('Origin', 'https://example.com')
  assert.equal(res.status, 200)
  assert.equal(res.headers['access-control-allow-origin'], 'https://example.com')
  if (orig !== undefined) process.env.CORS_ORIGIN = orig
})
```

with:

```ts
test('health endpoint blocks all origins when CORS_ORIGIN is not set', async () => {
  const orig = process.env.CORS_ORIGIN
  delete process.env.CORS_ORIGIN
  const db = makeMockDb()
  const app = createApp({ verifyToken: mockVerify, db, runAgentFn: mockRunAgent })
  const res = await request(app).get('/health').set('Origin', 'https://example.com')
  assert.equal(res.status, 200)
  assert.equal(res.headers['access-control-allow-origin'], undefined)
  if (orig !== undefined) process.env.CORS_ORIGIN = orig
})
```

The restore is deliberately one-sided and correct as-is: the test starts by deleting `CORS_ORIGIN`, so when the original value was `undefined` the correct end state is "still deleted". Do **not** add an `else delete` branch here. (The three tests above it need one only because they *set* a value.)

Note the assertion is on the header being absent, not on a non-200 status: `origin: false` withholds permission, it does not block the request. A 403 here would be wrong.

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd cloud-agent && npm test 2>&1 | grep -A 12 'blocks all origins when CORS_ORIGIN is not set'
```

Expected: FAIL — `AssertionError`, `actual: 'https://example.com'`, `expected: undefined`.

- [ ] **Step 3: Flip the default in `corsOrigins()`**

In `cloud-agent/src/index.ts`, replace:

```ts
function corsOrigins(): string | string[] | boolean {
  const raw = process.env.CORS_ORIGIN
  // No env var → reflect the request Origin (allow all). Safe because auth uses
  // Authorization header (not cookies), so credentials are not at risk.
  if (!raw) return true
```

with:

```ts
function corsOrigins(): string | string[] | boolean {
  const raw = process.env.CORS_ORIGIN
  // No env var → deny all cross-origin browser access. The only clients today
  // are the Expo mobile app and server-to-server callers, neither of which is
  // subject to CORS; a browser-based client must opt in via an explicit allowlist.
  if (!raw) return false
```

Everything below that early return — comma splitting, trimming, `new URL(value).origin` normalization, the `'*'` filter, and the `filtered.length > 0 ? filtered : false` fallback — is already correct. Leave it untouched.

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd cloud-agent && npm test 2>&1 | grep -A 4 'blocks all origins when CORS_ORIGIN is not set'
```

Expected: both wildcard and no-env-var variants report `ok`.

- [ ] **Step 5: Run the full suite — the three untouched CORS tests are the regression net**

```bash
cd cloud-agent && npm test 2>&1 | tail -20
```

Expected: `pass 280`, `fail 0`, `skipped 1` (same totals as before; one test changed meaning, none were added or removed). If any of the allowlisted-origin, preflight, or wildcard tests fail, the allowlist parsing was damaged — revert and redo Step 3 as a pure one-line change.

- [ ] **Step 6: Commit**

```bash
git add cloud-agent/src/index.ts cloud-agent/src/index.test.ts
git commit -m "fix(cloud-agent): default-deny CORS when CORS_ORIGIN is unset"
```

---

## Task 2: WebSocket origin verification on upgrade

**Files:**
- Modify: `cloud-agent/src/index.ts` (new `isAllowedWsOrigin` after `corsOrigins`; guard in `attachWebSocketRoutes`)
- Test: `cloud-agent/src/index.test.ts`

### Why these tests are shaped the way they are

Two constraints, both non-negotiable:

1. **Bind the real exported server factory.** `supertest` cannot perform WebSocket upgrades, so these tests need a real listener on an ephemeral port. Use `createApp()` + `attachWebSocketRoutes()` from `./index.js`. Standing up a fresh `http.createServer()` and re-implementing the origin check inline would test a *copy* of the logic while leaving the production handler unexercised — such tests keep passing through a real regression, which is worse than no tests because it reads as coverage.
2. **Use a raw `http.request`, not a `ws` client.** These four assertions only distinguish "403" from "upgraded". A `ws` client additionally computes and validates `Sec-WebSocket-Accept` and races the assertion, making the happy-path tests flaky for reasons unrelated to what they test.

- [ ] **Step 1: Add the `node:http` import and extend the dynamic import**

In `cloud-agent/src/index.test.ts`, add to the imports at the top of the file (after `import request from 'supertest'`):

```ts
import http from 'node:http'
```

Then change the existing dynamic import line

```ts
const { createApp, runAgentReal } = await import('./index.js')
```

to

```ts
const { createApp, attachWebSocketRoutes, runAgentReal } = await import('./index.js')
```

- [ ] **Step 2: Add the two test helpers**

Append these to `cloud-agent/src/index.test.ts`, at module scope, immediately below the dynamic-import line from Step 1:

```ts
/** Boots the real app + real upgrade handler on an ephemeral port. */
async function startWsTestServer(): Promise<{ port: number; close: () => Promise<void> }> {
  const db = makeMockDb()
  const appOptions = {
    verifyToken: mockVerify,
    db,
    runAgentFn: mockRunAgent,
    creditService: mockCreditService,
  }
  const server = createApp(appOptions).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  attachWebSocketRoutes(server, appOptions)
  const port = (server.address() as { port: number }).port
  return {
    port,
    close: async () => {
      // Upgraded sockets stay tracked by the http server; without this,
      // server.close() waits on them forever and the test times out.
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()))
      })
    },
  }
}

type UpgradeResult = { upgraded: true } | { upgraded: false; statusCode: number }

/** Issues a raw WebSocket upgrade and reports only whether it was accepted. */
async function attemptUpgrade(port: number, origin?: string): Promise<UpgradeResult> {
  const headers: Record<string, string> = {
    Connection: 'Upgrade',
    Upgrade: 'websocket',
    'Sec-WebSocket-Version': '13',
    'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
  }
  if (origin !== undefined) headers.Origin = origin

  return await new Promise<UpgradeResult>((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/agent/stream', headers })
    const timer = setTimeout(() => {
      req.destroy()
      reject(new Error('upgrade attempt timed out'))
    }, 5000)
    req.on('upgrade', (_res, socket) => {
      clearTimeout(timer)
      socket.destroy()
      resolve({ upgraded: true })
    })
    req.on('response', (res) => {
      clearTimeout(timer)
      res.resume()
      resolve({ upgraded: false, statusCode: res.statusCode ?? 0 })
    })
    req.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    req.end()
  })
}
```

`/agent/stream` is the path under test because it is the only one of the four that works with `admin.apps.length === 0` (the `/agent/browser` and `/agent/desktop` branches destroy the socket when the Firebase bridge is unavailable). The origin guard runs before path dispatch, so covering one path covers all four.

- [ ] **Step 3: Write the four failing upgrade tests**

Append to `cloud-agent/src/index.test.ts`:

```ts
// ── WebSocket upgrade origin verification ────────────────────────────────────

test('WS upgrade with no Origin header succeeds (native client path)', async () => {
  const orig = process.env.CORS_ORIGIN
  delete process.env.CORS_ORIGIN
  const srv = await startWsTestServer()
  try {
    const result = await attemptUpgrade(srv.port)
    assert.deepEqual(result, { upgraded: true })
  } finally {
    await srv.close()
    if (orig !== undefined) process.env.CORS_ORIGIN = orig
  }
})

test('WS upgrade with an Origin is rejected with 403 when CORS_ORIGIN is not set', async () => {
  const orig = process.env.CORS_ORIGIN
  delete process.env.CORS_ORIGIN
  const srv = await startWsTestServer()
  try {
    const result = await attemptUpgrade(srv.port, 'https://evil.example.com')
    assert.deepEqual(result, { upgraded: false, statusCode: 403 })
  } finally {
    await srv.close()
    if (orig !== undefined) process.env.CORS_ORIGIN = orig
  }
})

test('WS upgrade with an allowlisted Origin succeeds', async () => {
  const orig = process.env.CORS_ORIGIN
  process.env.CORS_ORIGIN = 'https://example.com'
  const srv = await startWsTestServer()
  try {
    const result = await attemptUpgrade(srv.port, 'https://example.com')
    assert.deepEqual(result, { upgraded: true })
  } finally {
    await srv.close()
    if (orig !== undefined) process.env.CORS_ORIGIN = orig
    else delete process.env.CORS_ORIGIN
  }
})

test('WS upgrade with a non-allowlisted Origin is rejected with 403', async () => {
  const orig = process.env.CORS_ORIGIN
  process.env.CORS_ORIGIN = 'https://example.com'
  const srv = await startWsTestServer()
  try {
    const result = await attemptUpgrade(srv.port, 'https://evil.example.com')
    assert.deepEqual(result, { upgraded: false, statusCode: 403 })
  } finally {
    await srv.close()
    if (orig !== undefined) process.env.CORS_ORIGIN = orig
    else delete process.env.CORS_ORIGIN
  }
})
```

- [ ] **Step 4: Run them to verify the two rejection tests fail**

```bash
cd cloud-agent && npm test 2>&1 | grep -B 2 -A 12 'WS upgrade with'
```

Expected: the two "succeeds" tests already pass (nothing rejects them yet), and both 403 tests FAIL with `upgraded: true` where `{ upgraded: false, statusCode: 403 }` was expected. That asymmetry is the point — it proves the guard is genuinely absent today.

- [ ] **Step 5: Add `isAllowedWsOrigin`**

In `cloud-agent/src/index.ts`, insert immediately after the closing brace of `corsOrigins()` (currently line 142, just before `export function createApp`):

```ts
export function isAllowedWsOrigin(origin: string | undefined): boolean {
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

Sharing `corsOrigins()` is the whole design: HTTP and WebSocket policy cannot drift apart, and any future allowlist entry applies to both automatically. Do not duplicate the parsing.

- [ ] **Step 6: Guard the upgrade handler**

In `cloud-agent/src/index.ts`, inside `attachWebSocketRoutes`, change:

```ts
  server.on('upgrade', (req, socket, head) => {
    const pathname = new URL(req.url ?? '', `http://${req.headers.host}`).pathname
```

to:

```ts
  server.on('upgrade', (req, socket, head) => {
    if (!isAllowedWsOrigin(req.headers.origin)) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    const pathname = new URL(req.url ?? '', `http://${req.headers.host}`).pathname
```

The guard sits above path dispatch so a rejected origin never reaches `handleUpgrade` and never allocates a socket. `Connection: close` is not strictly required — the `destroy()` ends the connection regardless — but it states the intent to any proxy between the client and Cloud Run instead of leaving them to infer it from a dropped socket. Leave the rest of the dispatch chain unchanged.

- [ ] **Step 7: Run the four tests to verify they pass**

```bash
cd cloud-agent && npm test 2>&1 | grep -A 4 'WS upgrade with'
```

Expected: all four report `ok`.

- [ ] **Step 8: Run the full suite**

```bash
cd cloud-agent && npm test 2>&1 | tail -20
```

Expected: `pass 284`, `fail 0`, `skipped 1` — 285 total, up 4 from the 281 baseline. Critically, the pre-existing WebSocket tests in `src/handlers/wsLiveAgentHandler.test.ts` and `src/integration.test.ts` must all still pass: they connect without an `Origin` header, which the `!origin → allow` rule permits. If any of them now fail, the guard is rejecting header-less upgrades and Step 5 was mis-transcribed.

- [ ] **Step 9: Commit**

```bash
git add cloud-agent/src/index.ts cloud-agent/src/index.test.ts
git commit -m "fix(cloud-agent): verify Origin on WebSocket upgrade"
```

---

## Task 3: Mark the spec implemented and verify the whole package

**Files:**
- Modify: `docs/superpowers/specs/2026-08-11-cloud-agent-cors-hardening-design.md:4`

- [ ] **Step 1: Run lint and typecheck**

```bash
cd cloud-agent && npx tsc --noEmit && cd .. && npm run lint
```

Expected: no TypeScript errors; lint clean. (`npm test` already runs `tsc`, but the explicit `--noEmit` pass catches errors in files the build might skip.)

- [ ] **Step 2: Confirm the permissive default is gone from the source**

```bash
cd cloud-agent && grep -n "return true" src/index.ts
```

Expected: exactly two hits, both inside `isAllowedWsOrigin` — `if (!origin) return true` and `if (allowed === true) return true`. If a `return true` still appears inside `corsOrigins()`, Task 1 was not applied.

- [ ] **Step 3: Flip the spec status**

In `docs/superpowers/specs/2026-08-11-cloud-agent-cors-hardening-design.md`, change:

```markdown
**Status:** Approved, not implemented
```

to:

```markdown
**Status:** Implemented
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-08-11-cloud-agent-cors-hardening-design.md
git commit -m "docs(specs): mark cloud-agent CORS hardening spec implemented"
```

---

## Rollout (after merge — not part of the coding tasks)

Per [CONTRIBUTING.md](../../../CONTRIBUTING.md), **the PR targets `staging`, not `main`.**

1. Merge to `staging`; deploy cloud-agent to staging.
2. Verify `/health` returns 200, and that the mobile app's chat, streaming, and live-voice paths all still connect.
3. Promote to production.
4. Confirm code scanning alert #26 auto-closes on the next CodeQL run against `main`.

**Do not set `CORS_ORIGIN` in Cloud Run for staging or production.** Leaving it unset *is* the hardened configuration; setting it is the change that would need justification. `docker-compose.local.yml:24` already sets it for local Expo web and needs no change.

**Rollback:** revert the two commits. No data migration, no config change, no coupling to the sibling dependency spec.
