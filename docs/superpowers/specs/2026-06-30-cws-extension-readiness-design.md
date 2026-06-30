# CWS Extension Readiness — Design Spec

**Date:** 2026-06-30
**Status:** Ready for implementation
**Scope:** Chrome Web Store submission preparation only — no new features
**Supersedes:** nothing — supplements `2026-06-29-mv3-browser-extension-bridge-design.md` (Phase 3 gate)

---

## Overview

The existing bridge extension is functionally complete per the June 29 spec (Phase 1 + Phase 2 stateful actions both implemented). This spec covers exactly what is required to pass the Chrome Web Store review gauntlet: five targeted code changes, a set of store submission artifacts, and the MV3 policy rationale behind each decision.

**Phase 3 gate from existing spec:**
> Policy preflight checklist passes, store listing approved.

This spec is that checklist.

---

## Section 1: Execution Checklist

Three files, five changes. No new features, no refactoring beyond scope.

---

### 1.1 `extension/manifest.json` — 3 additions

#### a) Add `icons` field and update `action.default_icon`

Files `icon-16.png`, `icon-48.png`, `icon-128.png` already exist in `extension/icons/`. The manifest does not declare them. CWS upload pipeline reads `icons.128` as the store listing icon — submission is blocked without it.

```json
"icons": {
  "16": "icons/icon-16.png",
  "48": "icons/icon-48.png",
  "128": "icons/icon-128.png"
}
```

Also add `128` to `action.default_icon` (current manifest only lists 16 and 48 — omitting 128 renders a blurry toolbar icon on hi-DPI displays):

```json
"action": {
  "default_popup": "ui/popup/index.html",
  "default_icon": {
    "16": "icons/icon-16.png",
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png"
  }
}
```

#### b) Add `key` field

The `key` field is the base64-encoded public key derived from the extension's `.pem` signing file. It locks the extension to a stable ID across unpacked dev loads and CWS re-uploads. Without it, every publish cycle can generate a new extension ID, breaking existing FCM device registrations stored in Firestore.

The `.pem` file is in 1Password. Never commit the private `.pem` — only the derived public `key` value is safe to commit.

```json
"key": "<BASE64_PUBLIC_KEY_FROM_1PASSWORD>"
```

To extract the public key from an existing `.pem`:
```bash
openssl rsa -in key.pem -pubout -outform DER | base64 | tr -d '\n'
```

#### c) Add `content_security_policy`

MV3 enforces a strict CSP by default, but reviewers confirm compliance by reading the manifest. An absent field forces the reviewer to infer. Explicit CSP also serves as a machine-readable guarantee that no `eval()`, inline scripts, or remote code is used.

```json
"content_security_policy": {
  "extension_pages": "script-src 'self'; object-src 'self';"
}
```

---

### 1.2 `extension/src/ui/side-panel/panel.ts:87` — replace `innerHTML` write

`innerHTML` assignment with string-concatenated content is flagged by the CWS automated scanner as a potential XSS vector, even when the data source is extension-internal (`chrome.storage.local`). Replace with safe DOM insertion.

```typescript
// BEFORE (lines 87-88) — flagged by CWS scanner
;($('log')).innerHTML = (actionLog as Array<{ ts: number; action: string; status: string }>)
  .map((e) => `<li>${new Date(e.ts).toLocaleTimeString()} ${e.action} ${e.status === 'complete' ? '✓' : '✕'}</li>`).join('')

// AFTER — safe DOM insertion
const logEl = $('log')
logEl.textContent = ''
for (const entry of actionLog as Array<{ ts: number; action: string; status: string }>) {
  const li = document.createElement('li')
  li.textContent = `${new Date(entry.ts).toLocaleTimeString()} ${entry.action} ${entry.status === 'complete' ? '✓' : '✕'}`
  logEl.appendChild(li)
}
```

**Note:** `dom-extractor.ts:10` uses `el.innerHTML` as a read — extracting live page content per user command. This is the extension's stated purpose, not a security concern. No change needed there.

---

### 1.3 `extension/src/background/auth-bridge.ts:8` — sharpen `offscreen` justification

`DOM_PARSER` is the accepted community workaround for Firebase Auth in MV3 (Chrome has no `INDEXEDDB` offscreen reason). The reason value stays. The `justification` string is what Chrome reviewers actually read — the current string is too vague to satisfy a reviewer who must approve the offscreen document use.

```typescript
// BEFORE
reasons: ['DOM_PARSER' as chrome.offscreen.Reason],
justification: 'Required to host Firebase Web Auth SDK which relies on DOM storage APIs',

// AFTER
reasons: ['DOM_PARSER' as chrome.offscreen.Reason],
justification:
  'Hosts Firebase Auth Web SDK (firebase/auth/web-extension). MV3 service workers ' +
  'cannot access DOM storage APIs required for auth token persistence. ' +
  'The offscreen document provides this context without exposing credentials ' +
  'to the service worker global scope.',
```

---

## Section 2: Store Submission Artifacts

Copy-paste ready for the CWS developer dashboard.

---

### 2.1 Store Listing Copy

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

### 2.2 Permission Justifications

One entry per permission, formatted for the CWS dashboard justification fields.

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

Note: the CWS dashboard does not have a standalone justification field for `optional_host_permissions`. Paste this text into the **"Single purpose description"** field and ensure it also appears in the detailed store description above.

```
Host access is entirely optional and user-granted per-site at runtime. The extension cannot declare a fixed list of hosts at install time because the user's AI assistant may target any site the user requests. Chrome prompts the user the first time a new host is needed. The user explicitly taps a "Grant Access" button in the side panel (a required user gesture — chrome.permissions.request() cannot be called from a service worker). Users can revoke permissions at any time via chrome://extensions. No host permission is ever requested proactively or silently.
```

---

### 2.3 Privacy Policy Addendum

Add to `clanker-ai.com/privacy` as a **dedicated section with this exact heading** so the CWS reviewer finds it without scanning. The Limited Use Disclosure in item 4 is a Chrome Web Store hard requirement — do not omit or paraphrase it.

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

## Section 3: CWS Rationale

### 3.1 Change → policy mapping

| Change | Policy basis | Risk if skipped |
|--------|-------------|-----------------|
| `innerHTML` → safe DOM | CWS automated scanner flags `innerHTML` with string concatenation regardless of data source. Triggers manual review queue. | Automated rejection before human review. |
| Explicit CSP | Reviewers confirm no `eval()` / remote code by reading the manifest. Absent field forces inference. | Extended manual review; reviewer may assume worst case. |
| `key` field | CWS binds the published extension ID to this key. Without it, ID can change between submission attempts, breaking existing Firestore device registrations. | Silent breakage of FCM wake pipeline post-publish. |
| Improved `offscreen` justification | Chrome policy requires the `justification` string to clearly explain why the offscreen document is needed. The previous string did not name the SDK or the service worker constraint. | Reviewer flags insufficient justification; delay or rejection. |
| `icons` field | CWS submission upload pipeline requires `icons.128`. Hard technical gate — submission blocked, not a policy issue. | Upload fails at submission step. |

### 3.2 Clean audit results

The following were audited and found clean. No changes required.

| Concern | Result |
|---------|--------|
| `eval()` / `new Function()` | None in extension source |
| `document.write()` | None |
| Remote script imports (CDN `<script src>`, `importScripts`) | None — all HTML pages load only bundled local `.js` files |
| Remote code fetch at runtime | None — `esbuild.mjs` bundles everything at build time; all `extensionEnv` values are compile-time constants |
| `innerHTML` write paths | One: `panel.ts:87` — fixed in §1.2. `dom-extractor.ts:10` is a read of page content; correct behavior |
| Declarative `content_scripts` | `[]` — empty, confirmed. Scripts injected only per-task |
| `optional_host_permissions` grant flow | Requires explicit user gesture (side panel button). Cannot be requested from service worker — correct |

### 3.3 Known risk outside this spec's scope

`chrome.gcm` is listed in Chrome's deprecation tracker. No removal date announced. If Chrome ships MV3-native Web Push (VAPID) before submission, the GCM registration flow in `service-worker.ts` and the `gcm` permission will need migration. CWS does not currently reject extensions using `gcm`. Tracked in the June 29 spec risk table.

---

## Phasing

This spec is Phase 3 of the existing roadmap:

| Phase | Gate |
|-------|------|
| 1 | 5 E2E read tasks + 1 approval flow ✓ |
| 2 | Stateful actions with mobile approval ✓ |
| **3 (this spec)** | **All §1 changes landed + §2 artifacts ready + §3 preflight passes → submit to CWS** |

---

## Open Questions (Deferred)

All open questions from the June 29 spec remain deferred:
1. Phase 2: auto-retry after host permission grant?
2. Phase 3: Cloud Scheduler task format?
3. Phase 4: single CWS listing vs. separate developer extension?
