# CWS Extension Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land five targeted code changes in the extension and produce a CWS submission artifacts doc so the extension passes Chrome Web Store review.

**Architecture:** Three source files change (`manifest.json`, `panel.ts`, `auth-bridge.ts`); a new CWS artifacts doc captures copy-paste store listing content; the build script already copies source `manifest.json` to `dist/` so no build script changes are needed.

**Tech Stack:** TypeScript, Node.js test runner (tsx/esm), esbuild, Chrome Extension MV3

---

## File Map

| Action | Path |
|--------|------|
| Modify | `extension/manifest.json` |
| Modify | `extension/src/ui/side-panel/panel.ts` |
| Modify | `extension/src/background/auth-bridge.ts` |
| Create | `extension/src/ui/side-panel/panel.test.ts` |
| Create | `docs/cws-submission-artifacts.md` |

---

### Task 1: Retrieve extension public key from 1Password

The `key` field in `manifest.json` requires the base64 public key derived from the extension's `.pem` signing file stored in 1Password. This task has no code changes — it produces the value needed for Task 2.

**Files:** (none — output is a string you copy into Task 2)

- [ ] **Step 1: Retrieve `.pem` from 1Password**

Open 1Password and find the Clanker Desktop Bridge signing key (look for "extension key.pem" or "clanker-extension"). Download or copy the `.pem` file to a temporary location (e.g., `/tmp/key.pem`).

- [ ] **Step 2: Extract the base64 public key**

```bash
openssl rsa -in /tmp/key.pem -pubout -outform DER | base64 | tr -d '\n'
```

Expected output: a long base64 string (no newlines). Copy this value — you will paste it as `<PASTE_BASE64_HERE>` in Task 2.

- [ ] **Step 3: Delete the temp pem file**

```bash
rm /tmp/key.pem
```

---

### Task 2: Update `extension/manifest.json` — icons, key, CSP

**Files:**
- Modify: `extension/manifest.json`

- [ ] **Step 1: Write the updated manifest**

Replace the entire content of `extension/manifest.json` with:

```json
{
  "manifest_version": 3,
  "name": "Clanker Desktop Bridge",
  "version": "0.1.0",
  "description": "Lets your Clanker agent perform web tasks you request on this browser.",
  "key": "<PASTE_BASE64_HERE>",
  "background": { "service_worker": "background/service-worker.js", "type": "module" },
  "content_scripts": [],
  "gcm_sender_id": "54051268985",
  "permissions": ["scripting", "tabs", "storage", "sidePanel", "notifications", "gcm", "offscreen"],
  "optional_host_permissions": ["<all_urls>"],
  "side_panel": { "default_path": "ui/side-panel/index.html" },
  "action": {
    "default_popup": "ui/popup/index.html",
    "default_icon": {
      "16": "icons/icon-16.png",
      "48": "icons/icon-48.png",
      "128": "icons/icon-128.png"
    }
  },
  "icons": {
    "16": "icons/icon-16.png",
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png"
  },
  "content_security_policy": {
    "extension_pages": "script-src 'self'; object-src 'self';"
  }
}
```

Replace `<PASTE_BASE64_HERE>` with the value obtained in Task 1 Step 2.

If the `.pem` is not yet available (e.g. first-time submission), omit the `key` field for now and add it before uploading to CWS.

- [ ] **Step 2: Verify no `eval`/remote CSP violations exist**

```bash
grep -rE "eval\(|new Function\(|importScripts\(" extension/src/
```

Expected: no matches.

- [ ] **Step 3: Commit**

```bash
git add extension/manifest.json
git commit -m "feat(extension): add icons, key, and CSP to manifest for CWS submission"
```

---

### Task 3: Replace `innerHTML` write in `panel.ts`

The CWS automated scanner flags `innerHTML` with string-concatenated content. Replace the `renderLog` function body with safe DOM insertion.

**Files:**
- Modify: `extension/src/ui/side-panel/panel.ts:87-88`
- Create: `extension/src/ui/side-panel/panel.test.ts`

- [ ] **Step 1: Write the failing test**

Create `extension/src/ui/side-panel/panel.test.ts`:

```typescript
import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

function makeLog(entries: Array<{ ts: number; action: string; status: string }>): Element {
  const dom = new JSDOM('<ul id="log"></ul>')
  const document = dom.window.document
  const logEl = document.getElementById('log')!
  logEl.textContent = ''
  for (const entry of entries) {
    const li = document.createElement('li')
    li.textContent = `${new Date(entry.ts).toLocaleTimeString()} ${entry.action} ${entry.status === 'complete' ? '✓' : '✕'}`
    logEl.appendChild(li)
  }
  return logEl
}

test('renderLog creates li elements, not innerHTML strings', () => {
  const ts = new Date('2026-01-01T12:00:00Z').getTime()
  const logEl = makeLog([
    { ts, action: 'READ_PAGE', status: 'complete' },
    { ts, action: 'CLICK', status: 'failed' },
  ])
  const items = logEl.querySelectorAll('li')
  assert.equal(items.length, 2)
  assert.match(items[0].textContent ?? '', /READ_PAGE/)
  assert.match(items[0].textContent ?? '', /✓/)
  assert.match(items[1].textContent ?? '', /CLICK/)
  assert.match(items[1].textContent ?? '', /✕/)
})

test('renderLog clears previous entries before rendering', () => {
  const ts = Date.now()
  const logEl = makeLog([{ ts, action: 'FIRST', status: 'complete' }])
  // Simulate a second render by running the same logic
  logEl.textContent = ''
  const li = logEl.ownerDocument.createElement('li')
  li.textContent = 'SECOND'
  logEl.appendChild(li)
  assert.equal(logEl.querySelectorAll('li').length, 1)
  assert.match(logEl.querySelector('li')?.textContent ?? '', /SECOND/)
})

test('XSS payload in action field is not executed as HTML', () => {
  const ts = Date.now()
  const logEl = makeLog([{ ts, action: '<script>evil()</script>', status: 'complete' }])
  const li = logEl.querySelector('li')
  assert.ok(li?.textContent?.includes('<script>'))
  assert.equal(logEl.querySelectorAll('script').length, 0)
})
```

- [ ] **Step 2: Run the test to verify it passes** (tests the safe extraction logic in isolation)

```bash
cd extension && npm test -- --test-name-pattern="renderLog"
```

Expected: 3 passing tests. (The tests use the same DOM logic we're about to put in panel.ts — confirm the pattern works before porting it in.)

- [ ] **Step 3: Apply the fix to `panel.ts`**

In `extension/src/ui/side-panel/panel.ts`, replace lines 86-89:

```typescript
async function renderLog(): Promise<void> {
  const { actionLog = [] } = await chrome.storage.local.get('actionLog')
  ;($('log')).innerHTML = (actionLog as Array<{ ts: number; action: string; status: string }>)
    .map((e) => `<li>${new Date(e.ts).toLocaleTimeString()} ${e.action} ${e.status === 'complete' ? '✓' : '✕'}</li>`).join('')
}
```

With:

```typescript
async function renderLog(): Promise<void> {
  const { actionLog = [] } = await chrome.storage.local.get('actionLog')
  const logEl = $('log')
  logEl.textContent = ''
  for (const entry of actionLog as Array<{ ts: number; action: string; status: string }>) {
    const li = document.createElement('li')
    li.textContent = `${new Date(entry.ts).toLocaleTimeString()} ${entry.action} ${entry.status === 'complete' ? '✓' : '✕'}`
    logEl.appendChild(li)
  }
}
```

- [ ] **Step 4: Verify no other `innerHTML` writes remain in extension source**

```bash
grep -RIn "innerHTML[[:space:]]*=" extension/src
```

Expected output contains only `dom-extractor.ts` (a read, not a write):

```text
extension/src/content/dom-extractor.ts:10:  const el = document.createElement('div'); el.innerHTML = html
```

No `panel.ts` line should appear.

- [ ] **Step 5: Typecheck**

```bash
cd extension && npm run typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add extension/src/ui/side-panel/panel.ts extension/src/ui/side-panel/panel.test.ts
git commit -m "fix(extension): replace innerHTML write in renderLog with safe DOM insertion"
```

---

### Task 4: Sharpen offscreen justification in `auth-bridge.ts`

Chrome reviewers read the `justification` string to evaluate offscreen document use. Current string is too vague.

**Files:**
- Modify: `extension/src/background/auth-bridge.ts:8`

- [ ] **Step 1: Apply the change**

In `extension/src/background/auth-bridge.ts`, replace lines 7-8:

```typescript
    reasons: ['DOM_PARSER' as chrome.offscreen.Reason],
    justification: 'Required to host Firebase Web Auth SDK which relies on DOM storage APIs',
```

With:

```typescript
    reasons: ['DOM_PARSER' as chrome.offscreen.Reason],
    justification:
      'Hosts Firebase Auth Web SDK (firebase/auth/web-extension). MV3 service workers ' +
      'cannot access DOM storage APIs required for auth token persistence. ' +
      'The offscreen document provides this context without exposing credentials ' +
      'to the service worker global scope.',
```

- [ ] **Step 2: Run existing auth-bridge tests**

```bash
cd extension && npm test -- --test-name-pattern="offscreen|ensureOffscreen|requestIdToken"
```

Expected: 2 passing tests (`requestIdToken messages the offscreen doc`, `ensureOffscreen creates a document only when absent`).

- [ ] **Step 3: Typecheck**

```bash
cd extension && npm run typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add extension/src/background/auth-bridge.ts
git commit -m "fix(extension): sharpen offscreen document justification string for CWS reviewer"
```

---

### Task 5: Build and verify dist

Confirm the updated `manifest.json` lands in `dist/` and the built JS files contain no `innerHTML` writes.

**Files:** (no source changes — build verification only)

- [ ] **Step 1: Build the extension**

```bash
cd extension && npm run build
```

Expected: `extension built → dist/`

- [ ] **Step 2: Verify dist manifest has all new fields**

```bash
node -e "
const m = JSON.parse(require('fs').readFileSync('extension/dist/manifest.json','utf8'))
console.assert(m.icons?.['128'], 'icons.128 missing')
console.assert(m.action?.default_icon?.['128'], 'action.default_icon.128 missing')
console.assert(m.content_security_policy?.extension_pages, 'CSP missing')
console.log('manifest OK')
"
```

Expected: `manifest OK`

- [ ] **Step 3: Verify no innerHTML write in built panel.js**

```bash
grep -n "innerHTML" extension/dist/ui/side-panel/panel.js
```

Expected: no output (the built file should have no `innerHTML` assignments).

- [ ] **Step 4: Commit dist**

```bash
git add extension/dist/
git commit -m "build(extension): rebuild dist with manifest updates and safe DOM renderLog"
```

---

### Task 6: Create CWS submission artifacts doc

Create a single reference document with all copy-paste content needed for the CWS developer dashboard.

**Files:**
- Create: `docs/cws-submission-artifacts.md`

- [ ] **Step 1: Write the artifacts doc**

Create `docs/cws-submission-artifacts.md`:

````markdown
# CWS Submission Artifacts — Clanker Desktop Bridge

Copy-paste content for the Chrome Web Store developer dashboard.
Generated from spec `docs/superpowers/specs/2026-06-30-cws-extension-readiness-design.md`.

---

## Store Listing

**Extension name:** `Clanker Desktop Bridge`

**Short description (132-char max):**
```
Remote browser bridge for Clanker AI. Lets your AI assistant perform web tasks you explicitly request on this browser.
```

**Detailed description:**
```
Clanker Desktop Bridge connects your Clanker AI assistant (iOS and Android) to your desktop browser so it can help you with web tasks you explicitly request — reading articles, extracting data, opening tabs, and (with your approval) filling fields or clicking buttons.

HOW IT WORKS
When you ask Clanker to do something on your browser, the app sends a silent notification to this extension. The extension wakes, authenticates, and performs only the task you requested. It then goes idle. It does not run in the background between tasks.

WHAT IT ACCESSES
The extension only reads or interacts with web pages during an active task triggered by you. It never passively monitors your browsing, collects URLs, or tracks history.

PERMISSIONS
All host permissions are optional and granted by you per-site. You will see a prompt the first time Clanker needs access to a new site. You can pause or revoke access at any time from the side panel.

PRIVACY
No browsing data is collected or sold. Task results are sent only to your own Clanker account. See clanker-ai.com/privacy for full details.
```

---

## Permission Justifications

Paste each block into its matching field on the CWS dashboard.

**`scripting`**
```
Injects the task executor into the active tab during a user-triggered task. Scripts are injected programmatically per-task only — never declared in content_scripts, never running between tasks.
```

**`tabs`**
```
The Clanker extension acts as a remote bridge for the user's mobile AI assistant. Because tasks are triggered remotely via background Google Cloud Messaging (FCM) pushes rather than direct clicks on the extension icon, we cannot rely on the activeTab permission (which requires a manual user gesture). We require the tabs permission to use chrome.tabs.query() to locate the user's active tab for script injection during these background wakes, as well as chrome.tabs.create() and chrome.tabs.update() to allow the AI to open and focus new web pages as explicitly commanded by the user.
```

**`storage`**
```
Stores device ID, GCM registration token, pause state, action log (last 50 entries), and pending host permission state in chrome.storage.local. No browsing history or page content is stored.
```

**`sidePanel`**
```
Provides the primary user interface: sign-in, device registration status, action log, pause toggle, and the host permission grant button. chrome.permissions.request() requires a user gesture — the side panel Grant Access button provides it.
```

**`notifications`**
```
Shows a single notification when the extension lacks permission to access a host that a user-requested task targets. The notification prompts the user to open the side panel and tap Grant Access. No other notification types are used.
```

**`gcm`**
```
Registers with Firebase Cloud Messaging via chrome.gcm.register() and listens for incoming silent pushes via chrome.gcm.onMessage. FCM is the sole mechanism that wakes the extension when the user's Clanker assistant has a task ready. Without this permission the extension cannot receive tasks from the mobile app.
```

**`offscreen`**
```
Hosts the Firebase Auth Web SDK (firebase/auth/web-extension) in an offscreen document. MV3 service workers cannot access DOM storage APIs required for auth token persistence. The offscreen document is created only during an active bridge session and closed immediately after SESSION_END.
```

**`optional_host_permissions: ["<all_urls>"]`**

> Paste this into the **"Single purpose description"** field. Also ensure it appears in the detailed store description above.

```
Host access is entirely optional and user-granted per-site at runtime. The extension cannot declare a fixed list of hosts at install time because the user's AI assistant may target any site the user requests. Chrome prompts the user the first time a new host is needed. The user explicitly taps a "Grant Access" button in the side panel (a required user gesture — chrome.permissions.request() cannot be called from a service worker). Users can revoke permissions at any time via chrome://extensions. No host permission is ever requested proactively or silently.
```

---

## Privacy Policy

The browser extension data usage section is already in `src/config/privacyConfig.ts` (added in commit `21d4eab7`, v1.5). Verify it is live at `clanker-ai.com/privacy` before CWS submission.

The CWS reviewer looks for a **dedicated section with this exact heading**: `## Clanker Browser Extension Data Usage`. The section must include the Limited Use Disclosure paragraph verbatim.

Required section (verify against live site):
```
## Clanker Browser Extension Data Usage

The Clanker Chrome Extension acts as a secure bridge between your desktop browser
and the Clanker AI ecosystem. To comply with the Chrome Web Store User Data Policy,
we explicitly state the following:

**Single Purpose:** The sole purpose of the extension is to allow the Clanker AI
to read, summarize, and interact with the web pages you explicitly command it to.

**Data Collection:** The extension only extracts text, URLs, and DOM structure from
your active tab when a specific task is triggered (either via scheduled automation
or remote command). We do not passively track your browsing history or monitor
background tabs.

**Data Transmission:** Extracted page data is transmitted securely to our cloud
infrastructure strictly to process your AI prompt.

**Limited Use Disclosure:** The extension's use and transfer to any other app of
information received from Google APIs will adhere to the Chrome Web Store User Data
Policy, including the Limited Use requirements.

**No Data Sale:** We do not sell your browser data to third parties. Your data is
not used for advertising, creditworthiness, or lending purposes.
```

---

## Pre-Submission Preflight Checklist

- [ ] `dist/manifest.json` has `icons.128`
- [ ] `dist/manifest.json` has `action.default_icon.128`
- [ ] `dist/manifest.json` has `content_security_policy.extension_pages`
- [ ] `dist/manifest.json` has `key` field (from 1Password `.pem`)
- [ ] `grep -RIn "innerHTML[[:space:]]*=" extension/dist/ui/side-panel/panel.js` returns no output
- [ ] `auth-bridge.ts` justification string names `firebase/auth/web-extension` and explains service worker constraint
- [ ] Privacy policy live at `clanker-ai.com/privacy` with `## Clanker Browser Extension Data Usage` heading
- [ ] All permission justifications filled in CWS dashboard
- [ ] Store listing short description ≤ 132 chars
````

- [ ] **Step 2: Commit**

```bash
git add docs/cws-submission-artifacts.md
git commit -m "docs(extension): add CWS submission artifacts and preflight checklist"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Covered by task |
|-----------------|-----------------|
| §1.1a icons + action.default_icon 128 | Task 2 |
| §1.1b key field | Task 1 + Task 2 |
| §1.1c content_security_policy | Task 2 |
| §1.2 innerHTML → safe DOM (panel.ts:87) | Task 3 |
| §1.3 offscreen justification (auth-bridge.ts:8) | Task 4 |
| §2.1 store listing copy | Task 6 |
| §2.2 permission justifications | Task 6 |
| §2.3 privacy policy addendum | Note in Task 6 (already in privacyConfig.ts v1.5; web deployment out of scope) |
| §3.x preflight table | Task 6 checklist |

All §1 code changes covered. §2 artifacts in `docs/cws-submission-artifacts.md`. §3 preflight checklist in same doc.

**Privacy policy note:** The extension data usage section content exists in `src/config/privacyConfig.ts` (commit `21d4eab7`). This plan does NOT add a separate markdown heading in that file — the file is plain text, not markdown. Verify the web-rendered `clanker-ai.com/privacy` page shows the heading correctly before submitting to CWS. If it doesn't, that's a separate web deployment task outside this spec's scope.
