# Browser Extension Remote Agent Bridge (MV3) — Draft Design Spec

## Overview

Goal: let user chat with Clanker app on phone, while trusted browser extension on
user home desktop performs browser tasks on authenticated sites user already uses.

Core value: cross-device agent action, not generic automation platform.

Working single-purpose statement (store listing + UI):
"Clanker companion extension that lets your Clanker agent perform web tasks you
explicitly request on this device."

---

## Feasibility

Feasible: yes.

Hard parts:
1. Policy-safe scope definition (single purpose + limited permissions).
2. Safety controls for remote commands (confirmations, allowlist, audit).
3. MV3 compliance (no remote code execution, all logic shipped in package).

Firebase auth reuse in extension: moderate difficulty, not hard.
Use Firebase Web Auth in extension UI context (popup/sidepanel/offscreen page),
then mint Firebase ID token and call existing/extended callable APIs.

---

## Policy Constraints (MV3 + CWS)

1. No remote code execution.
- No eval/new Function on server-fed code.
- No remote JS/Wasm/CSS as executable logic.
- Server may send data/config/intent, extension executes local bundled logic only.

2. Single purpose must be narrow.
- Avoid "general remote browser control" positioning.
- Keep purpose: Clanker-assistant actions user requested.

3. Limited permissions.
- Request minimum host permissions + APIs needed now.
- No future-proof broad permissions.

4. Data use limited to purpose.
- Collected page data must serve active user-requested task only.
- No ad/data-broker use. No hidden background scraping.

5. Transparent user disclosures.
- Clear pre-install and in-product disclosure: what collected, when, why, where sent.

---

## Approaches

### Approach A (recommended): Task DSL + Local Executor

Phone app sends high-level task intents via backend queue.
Extension receives task, executes from fixed local action catalog:
- open_tab(url)
- focus_tab(host)
- extract(selector|preset)
- fill_field(selector, value)
- click(selector)
- summarize_visible_text

No remote script injection from server. Server sends data only.

Pros:
- Best MV3 policy posture.
- Reviewable deterministic behavior.
- Easier safety gates and tests.

Cons:
- Slower feature velocity vs arbitrary code runner.
- Needs robust selector strategy.

### Approach B: User-script style mini interpreter (not recommended)

Server sends command lists interpreted by extension runtime.

Pros:
- Flexible fast iteration.

Cons:
- High MV3 rejection risk (looks like remote logic execution).
- Hard to prove full functionality in submitted code.

### Approach C: Human-in-the-loop assistant only

Extension proposes steps, user approves each step manually.

Pros:
- Lowest abuse risk.
- Strong policy optics.

Cons:
- Lower automation value.
- Worse UX for long tasks.

Recommendation: Approach A + optional step-up confirmations from C.

---

## Proposed Architecture

### Components

1. Mobile app (existing Clanker chat UI)
- User issues task in chat.
- Backend normalizes to approved action plan.

2. Cloud coordinator (Functions)
- Authenticated task queue per user/device pair.
- Policy checks, rate limits, action schema validation.
- Stores task/audit state.

3. Chrome extension (MV3)
- service_worker: polling/subscription, command dispatch.
- content scripts: DOM read/write with strict action handlers.
- side panel/popup: sign-in, pairing status, approvals, logs.

4. Device pairing
- User pairs phone account with desktop extension once.
- Pair token/device key stored securely in extension storage.

### Data Flow (happy path)

1. User on phone: "Pay electric bill on provider site."
2. Backend compiles into allowed action sequence (data-only payload).
3. Extension on paired desktop pulls task.
4. Extension validates host/action against local allowlist.
5. If sensitive step: ask user confirm in side panel.
6. Extension executes local handlers via content script.
7. Results/snapshots sent back to backend.
8. Phone app chat gets completion summary.

---

## Authentication Model

Use same Firebase project and user identity.

### Extension auth

1. Extension UI starts Firebase Auth web flow.
2. On sign-in, extension gets Firebase ID token.
3. Extension calls callable endpoints with Firebase auth context.
4. Backend binds extension session to Firebase uid.

### Pairing model

- Pairing code generated in phone app (short-lived, one-time).
- Extension enters/scans code to register desktop device.
- Backend issues device credential scoped to uid + device_id.
- All remote tasks require both user auth + registered device.

### Token handling

- Keep refresh tokens in extension storage only.
- Never expose credentials to content script.
- Content script receives short-lived task payload only.

---

## Privacy + Safety Guardrails

1. Explicit consent boundary
- Extension executes only for user-initiated tasks from Clanker chat.
- Optional global toggle: "Pause remote actions".

2. Host allowlisting
- Start with user-approved host list.
- Block execution on non-approved hosts.

3. Sensitive action confirmation
- Require per-step confirm for submit/payment/delete/account changes.

4. Data minimization
- Return only fields needed for requested outcome.
- Redact secrets by default (passwords, card fields, OTP fields).

5. Full audit trail
- Log task id, action type, host, timestamp, user confirm events.
- Show logs in extension UI.

6. Fail-closed behavior
- Unknown action => reject.
- Selector mismatch => safe stop + ask user.

---

## Permission Strategy (initial)

Prefer minimal:
- activeTab
- scripting
- storage
- alarms
- sidePanel (or action/popup if side panel not used)

Host permissions:
- Start optional per-site grants from user action.
- Avoid broad <all_urls> at launch if possible.

---

## Compliance Narrative for Review

1. Single purpose: companion for Clanker-requested browser assistance.
2. No hidden behavior: all actions visible in extension UI + logs.
3. No remote code execution: server sends task data, extension executes bundled code.
4. Data usage bounded to user-requested task completion.
5. Strong user control: approvals, pause switch, uninstall fully disables.

---

## MVP Scope

Include:
1. Pairing phone app <-> one desktop extension.
2. Read page text + extract structured fields on approved hosts.
3. Fill non-sensitive forms + click non-destructive buttons.
4. Confirmation flow for sensitive actions.
5. End-to-end chat status updates.

Exclude (v1):
1. Arbitrary script/code execution.
2. Background scraping without active task.
3. Multi-desktop orchestration.
4. File system automation.

---

## Risks

1. Store rejection for "too broad" purpose.
- Mitigation: tight scope, explicit allowlist, narrow listing language.

2. Selector brittleness on dynamic sites.
- Mitigation: site adapters + retry strategy + human confirm fallback.

3. Security concerns from remote command channel.
- Mitigation: signed task payloads, nonce/replay protection, strict schema validation.

4. User trust risk.
- Mitigation: transparency dashboard + explicit approvals + easy kill switch.

---

## Test Strategy

1. Unit
- Action schema validator
- Host allowlist matcher
- Sensitive action classifier

2. Integration
- Firebase auth in extension UI
- Pairing + task pull + result push

3. E2E
- Phone request -> desktop execution -> phone completion
- Sensitive step confirm + reject flows
- Permission denied and revoked scenarios

4. Policy preflight checklist
- No remote executable code paths
- Permission justification for each API
- Privacy disclosures match runtime behavior

---

## Open Questions

1. Proactive autonomy level:
- Always require step confirmation, or only for sensitive classes?

2. Host scope:
- User-defined hosts only, or prebuilt adapters for known services?

3. Desktop offline behavior:
- Queue TTL and retry semantics when extension/browser closed?

4. Human review:
- Need optional "preview action plan" before first step?

---

## Suggested Next Step

After design approval, create implementation plan in phases:
1. Auth + pairing foundation.
2. Task DSL + local executor.
3. Safety/compliance UX.
4. Pilot with 1-2 target sites.
