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
- [ ] `grep -n "innerHTML\s*=" extension/dist/ui/side-panel/panel.js` returns no output
- [ ] `auth-bridge.ts` justification string names `firebase/auth/web-extension` and explains service worker constraint
- [ ] Privacy policy live at `clanker-ai.com/privacy` with `## Clanker Browser Extension Data Usage` heading
- [ ] All permission justifications filled in CWS dashboard
- [ ] Store listing short description ≤ 132 chars
