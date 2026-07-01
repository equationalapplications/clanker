# Live-Voice Credit Reconciliation & In-Call Indicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make live-voice credit spends reflect in the credit badge/`CreditsDisplay` live and after a call, add an in-call credit indicator to the Talk screen, and delete the dead one-shot `generateVoiceReply` path.

**Architecture:** `useLiveVoiceChat` already holds `authService` and the machine's `remainingCredits`. A `useEffect` with a previous-value ref dispatches `USAGE_SNAPSHOT_RECEIVED` (source `liveVoice`, client-synthesized `verifiedAt`) on each socket-driven change, reusing the existing timestamp-gated `applyUsageSnapshotIfNewer`. The Talk screen renders the machine's `remainingCredits` while live. The unused `generateVoiceReply` client→Firebase chain is removed entirely.

**Tech Stack:** React Native / Expo, XState v5, TypeScript, Jest + react-test-renderer, Firebase Functions.

**Spec:** `docs/superpowers/specs/2026-07-01-live-voice-credit-reconciliation-design.md`

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/machines/authMachine.ts` | Auth event types | Add `'liveVoice'` to `USAGE_SNAPSHOT_RECEIVED.source` union |
| `src/hooks/useLiveVoiceChat.ts` | Live-voice controller | Add reconcile `useEffect` with prev-value ref |
| `__tests__/useLiveVoiceChat.test.tsx` | Hook tests | Add reconcile tests; give `useAuthMachine` mock a `send` |
| `app/(drawer)/(tabs)/talk/index.tsx` | Talk screen UI | Render in-call credit count + low-threshold emphasis |
| `__tests__/talkScreenCreditIndicator.test.tsx` | UI test | New test for indicator visibility/emphasis |
| `src/services/voiceChatService.ts` | Dead | Delete |
| `src/services/voiceReplyService.ts` | Dead | Delete |
| `src/config/firebaseConfig.ts` | Callable config | Remove `generateVoiceReplyFn` |
| `src/config/firebaseConfig.web.ts` | Callable config (web) | Remove `generateVoiceReplyFn` |
| `__tests__/voiceChatService.test.ts` | Dead test | Delete |
| `__tests__/voiceReplyService.test.ts` | Dead test | Delete |
| `__tests__/firebaseConfigWebVoiceCallable.test.ts` | Dead test | Delete |
| `functions/src/generateVoiceReply.ts` | Dead callable | Delete |
| `functions/src/generateVoiceReply.test.ts` | Dead test | Delete |
| `functions/src/index.ts` | Functions exports | Remove `generateVoiceReply` export |
| `docs/billing-and-credits.md` | Cost docs | Remove one-shot voice row |

---

## Task 1: Live-Voice → Auth Reconciliation

**Files:**
- Modify: `src/machines/authMachine.ts:70`
- Modify: `src/hooks/useLiveVoiceChat.ts` (add `useEffect`; `useRef` already imported at line 1)
- Test: `__tests__/useLiveVoiceChat.test.tsx`

- [ ] **Step 1: Extend the source union**

In `src/machines/authMachine.ts`, the `USAGE_SNAPSHOT_RECEIVED` event (around line 68-75) has:

```typescript
      source: 'generateReply' | 'generateImage' | 'cloudAgent'
```

Change to:

```typescript
      source: 'generateReply' | 'generateImage' | 'cloudAgent' | 'liveVoice'
```

- [ ] **Step 2: Update the `useAuthMachine` mock to expose `send`**

In `__tests__/useLiveVoiceChat.test.tsx`, add a mock fn near the other `const mock...` declarations (after line 16):

```typescript
const mockAuthSend = jest.fn()
```

Replace the existing mock (line 31):

```typescript
jest.mock('~/hooks/useMachines', () => ({ useAuthMachine: () => ({}) }))
```

with:

```typescript
jest.mock('~/hooks/useMachines', () => ({ useAuthMachine: () => ({ send: mockAuthSend }) }))
```

- [ ] **Step 3: Write the failing reconcile tests**

Add to the `describe('useLiveVoiceChat', ...)` block in `__tests__/useLiveVoiceChat.test.tsx`. These rerender the harness with a changed machine snapshot to simulate a socket tick.

```typescript
  test('does not dispatch USAGE_SNAPSHOT_RECEIVED on initial seed', async () => {
    mockUseCharacter.mockReturnValue({ data: { id: 'char1', voice: 'en-US', save_to_cloud: 1 } })
    mockUseCurrentPlan.mockReturnValue({ remainingCredits: 10 })

    await act(async () => {
      create(<TestHarness onMount={() => {}} />)
    })

    expect(mockAuthSend).not.toHaveBeenCalled()
  })

  test('dispatches USAGE_SNAPSHOT_RECEIVED when live remainingCredits changes', async () => {
    mockUseCharacter.mockReturnValue({ data: { id: 'char1', voice: 'en-US', save_to_cloud: 1 } })
    mockUseCurrentPlan.mockReturnValue({ remainingCredits: 10 })

    let root: ReturnType<typeof create>
    await act(async () => {
      root = create(<TestHarness onMount={() => {}} />)
    })

    // Simulate a per-minute socket tick: machine now reports 9 credits.
    const tickSnapshot = {
      matches: (pattern: unknown) => {
        if (typeof pattern === 'object' && pattern !== null) {
          return (pattern as Record<string, string>)['session'] === 'live'
        }
        return false
      },
      context: { transcript: [], activeTool: null, remainingCredits: 9, socketError: null },
    }
    mockUseMachine.mockReturnValue([tickSnapshot, mockSend, { subscribe: jest.fn(), getSnapshot: () => tickSnapshot }])

    await act(async () => {
      root!.update(<TestHarness onMount={() => {}} />)
    })

    expect(mockAuthSend).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'USAGE_SNAPSHOT_RECEIVED',
        source: 'liveVoice',
        remainingCredits: 9,
        planTier: null,
        verifiedAt: expect.any(String),
      }),
    )
  })

  test('does not re-dispatch when remainingCredits is unchanged across renders', async () => {
    mockUseCharacter.mockReturnValue({ data: { id: 'char1', voice: 'en-US', save_to_cloud: 1 } })
    mockUseCurrentPlan.mockReturnValue({ remainingCredits: 10 })

    let root: ReturnType<typeof create>
    await act(async () => {
      root = create(<TestHarness onMount={() => {}} />)
    })

    await act(async () => {
      root!.update(<TestHarness onMount={() => {}} />)
    })

    expect(mockAuthSend).not.toHaveBeenCalled()
  })
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npm test -- useLiveVoiceChat`
Expected: FAIL — `mockAuthSend` never called (reconcile effect not yet written).

- [ ] **Step 5: Add the reconcile effect**

In `src/hooks/useLiveVoiceChat.ts`, after the existing `useMachine` call (line 62-68) and near the other effects, add:

```typescript
  // Reconcile live-voice credit ticks back to the auth machine so the header
  // badge and CreditsDisplay reflect voice spends live and after a call.
  // The socket USAGE_SNAPSHOT carries no server timestamp, so we synthesize a
  // client ISO time (same as the cloud-agent path in useAIChat); successive
  // ticks are monotonic and pass applyUsageSnapshotIfNewer. The ref stores the
  // previous value and gates on prev !== current, which skips the initial seed
  // and is safe against StrictMode double-firing.
  const prevCreditsRef = useRef(state.context.remainingCredits)
  useEffect(() => {
    const current = state.context.remainingCredits
    if (prevCreditsRef.current === current) return
    prevCreditsRef.current = current
    authService.send({
      type: 'USAGE_SNAPSHOT_RECEIVED',
      source: 'liveVoice',
      remainingCredits: current,
      planTier: null,
      planStatus: null,
      verifiedAt: new Date().toISOString(),
    })
  }, [state.context.remainingCredits, authService])
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test -- useLiveVoiceChat`
Expected: PASS (all reconcile tests + existing tests green).

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: pass (source union now includes `'liveVoice'`).

- [ ] **Step 8: Commit**

```bash
git add src/machines/authMachine.ts src/hooks/useLiveVoiceChat.ts __tests__/useLiveVoiceChat.test.tsx
git commit -m "feat(credits): reconcile live-voice spends to the credit badge

Dispatch USAGE_SNAPSHOT_RECEIVED (source liveVoice) from useLiveVoiceChat
on each socket-driven remainingCredits change, using a prev-value ref to
skip the seed and a client-synthesized verifiedAt. The badge/CreditsDisplay
now tick down during a call and stay correct after teardown.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: In-Call Credit Indicator

**Files:**
- Modify: `app/(drawer)/(tabs)/talk/index.tsx`
- Test: `__tests__/talkScreenCreditIndicator.test.tsx` (create)

- [ ] **Step 1: Write the failing UI test**

Create `__tests__/talkScreenCreditIndicator.test.tsx`. This mirrors the mock setup in `__tests__/talkScreenStatusLiveRegion.test.tsx`, but drives `useLiveVoiceChat` return values per test via a mutable object.

```typescript
import React from 'react'
import { create, act } from 'react-test-renderer'

const liveVoiceReturn: Record<string, unknown> = {}

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ characterId: 'char-1' }),
  router: { push: jest.fn() },
  useFocusEffect: jest.fn(),
}))
jest.mock('~/hooks/useCharacters', () => ({
  useCharacter: () => ({ data: { id: 'char-1', name: 'Frodo', avatar: null }, isLoading: false }),
}))
jest.mock('~/hooks/useTabCharacterId', () => ({
  useTabCharacterId: () => ({ characterId: 'char-1', isLoading: false, isCreatingDefault: false }),
}))
jest.mock('~/hooks/useLiveVoiceChat', () => ({
  useLiveVoiceChat: () => liveVoiceReturn,
}))
jest.mock('~/hooks/useMachines', () => ({ useCharacterMachine: jest.fn() }))
jest.mock('@xstate/react', () => ({
  useSelector: (_: any, sel: any) => sel({ matches: () => false }),
}))
jest.mock('react-native-reanimated', () => {
  const React = require('react')
  return {
    __esModule: true,
    default: { View: ({ children, style }: any) => React.createElement('View', { style }, children) },
    useSharedValue: (v: any) => ({ value: v }),
    useAnimatedStyle: () => ({}),
    withRepeat: (v: any) => v,
    withTiming: (v: any) => v,
    cancelAnimation: jest.fn(),
    Easing: { inOut: () => ({}), ease: {} },
  }
})
jest.mock('react-native', () => {
  const React = require('react')
  return {
    StyleSheet: { create: (s: any) => s },
    Platform: { OS: 'android' },
    Linking: { openURL: jest.fn() },
    TouchableOpacity: ({ children, ...p }: any) => React.createElement('TouchableOpacity', p, children),
    View: ({ children, ...p }: any) => React.createElement('View', p, children),
    Pressable: ({ children, ...p }: any) => React.createElement('Pressable', p, children),
    ActivityIndicator: ({ size, style }: any) => React.createElement('ActivityIndicator', { size, style }),
  }
})
jest.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }))
jest.mock('~/components/CharacterAvatar', () => () => null)
jest.mock('~/components/GroundingHtml', () => ({ GroundingHtml: () => null }))
jest.mock('expo-router/react-navigation', () => ({
  useFocusEffect: jest.fn(),
  useNavigation: () => ({
    navigate: jest.fn(),
    goBack: jest.fn(),
    addListener: jest.fn().mockReturnValue(jest.fn()),
    getParent: () => ({ getParent: () => ({ setOptions: jest.fn() }) }),
  }),
}))
jest.mock('react-native-paper', () => {
  const React = require('react')
  return { Text: ({ children, ...props }: any) => React.createElement('Text', props, children) }
})

import TalkTabScreen from '../app/(drawer)/(tabs)/talk/index'

function baseReturn(overrides: Record<string, unknown>) {
  return {
    isConnecting: false,
    isLive: false,
    isSyncing: false,
    syncPhase: null,
    error: null,
    transcript: [],
    activeTool: null,
    groundingMetadata: null,
    remainingCredits: 10,
    isPlayingAudio: false,
    startCall: jest.fn(),
    endCall: jest.fn(),
    cancelCall: jest.fn(),
    ...overrides,
  }
}

function findCreditNode(tree: any) {
  return tree.root
    .findAll((n: any) => n.type === 'Text')
    .find((n: any) => n.props.accessibilityLabel === 'Credits remaining')
}

describe('Talk screen credit indicator', () => {
  it('hides the credit count when not in a call', () => {
    Object.assign(liveVoiceReturn, baseReturn({ isLive: false, isConnecting: false }))
    let tree: any
    act(() => { tree = create(<TalkTabScreen />) })
    expect(findCreditNode(tree)).toBeUndefined()
  })

  it('shows the credit count while live', () => {
    Object.assign(liveVoiceReturn, baseReturn({ isLive: true, remainingCredits: 8 }))
    let tree: any
    act(() => { tree = create(<TalkTabScreen />) })
    const node = findCreditNode(tree)
    expect(node).toBeDefined()
    expect(node.props.children).toEqual([8, ' credits'])
  })

  it('applies low-credit emphasis at or below the threshold', () => {
    Object.assign(liveVoiceReturn, baseReturn({ isLive: true, remainingCredits: 3 }))
    let tree: any
    act(() => { tree = create(<TalkTabScreen />) })
    const node = findCreditNode(tree)
    expect((node.props.style as unknown[]).filter(Boolean)).toHaveLength(2)
  })

  it('applies no emphasis above the threshold', () => {
    Object.assign(liveVoiceReturn, baseReturn({ isLive: true, remainingCredits: 8 }))
    let tree: any
    act(() => { tree = create(<TalkTabScreen />) })
    const node = findCreditNode(tree)
    expect((node.props.style as unknown[]).filter(Boolean)).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- talkScreenCreditIndicator`
Expected: FAIL — no `Text` node with `accessibilityLabel="Credits remaining"`.

- [ ] **Step 3: Add the `LOW_CREDIT_THRESHOLD` constant**

In `app/(drawer)/(tabs)/talk/index.tsx`, after the existing constants (line 31-32):

```typescript
const AVATAR_SIZE = 200
const GLOW_SIZE = AVATAR_SIZE + 60
const LOW_CREDIT_THRESHOLD = 5
```

- [ ] **Step 4: Destructure `remainingCredits` from the hook**

In the `TalkView` component, the `useLiveVoiceChat` destructure (lines 85-97) omits `remainingCredits`. Add it:

```typescript
  const {
    isConnecting,
    isLive,
    isSyncing,
    syncPhase,
    error,
    transcript,
    activeTool,
    groundingMetadata,
    isPlayingAudio,
    remainingCredits,
    startCall,
    endCall,
  } = useLiveVoiceChat(characterId)
```

- [ ] **Step 5: Render the indicator**

In the returned JSX, add the credit count directly after the `statusWrap` `View` (after line 202, before the grounding block):

```tsx
      {isLive || isConnecting ? (
        <Text
          accessibilityLabel="Credits remaining"
          style={[
            styles.creditCount,
            remainingCredits <= LOW_CREDIT_THRESHOLD ? styles.creditCountLow : null,
          ]}
        >
          {remainingCredits} credits
        </Text>
      ) : null}
```

- [ ] **Step 6: Add the styles**

In the `StyleSheet.create({ ... })` block, add after `errorText` (line 328-330):

```typescript
  creditCount: {
    fontSize: 13,
    opacity: 0.7,
    marginTop: 4,
  },
  creditCountLow: {
    color: '#b00020',
    opacity: 1,
    fontWeight: '600',
  },
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npm test -- talkScreenCreditIndicator`
Expected: PASS (all four cases).

- [ ] **Step 8: Run the existing Talk screen tests to check for regression**

Run: `npm test -- talkScreen`
Expected: PASS (grounding + live-region tests unaffected).

- [ ] **Step 9: Commit**

```bash
git add "app/(drawer)/(tabs)/talk/index.tsx" __tests__/talkScreenCreditIndicator.test.tsx
git commit -m "feat(credits): show remaining credits during a live voice call

Render the machine's remainingCredits on the Talk screen while
live/connecting, with warn-color emphasis at or below 5 credits.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Delete Dead Voice Path (Client)

**Files:**
- Delete: `src/services/voiceChatService.ts`, `src/services/voiceReplyService.ts`
- Delete: `__tests__/voiceChatService.test.ts`, `__tests__/voiceReplyService.test.ts`, `__tests__/firebaseConfigWebVoiceCallable.test.ts`
- Modify: `src/config/firebaseConfig.ts`, `src/config/firebaseConfig.web.ts`

- [ ] **Step 1: Confirm no non-test references**

Run:

```bash
grep -rn "sendVoiceMessage\|voiceReplyService\|generateVoiceReplyFn" src app | grep -v ".test."
```

Expected output: only `src/services/voiceChatService.ts`, `src/services/voiceReplyService.ts`, and the two `firebaseConfig` files (the definitions themselves). No caller in `app/` or elsewhere in `src/`. If any other caller appears, STOP and revisit the spec.

- [ ] **Step 2: Delete the dead client files**

```bash
git rm src/services/voiceChatService.ts src/services/voiceReplyService.ts \
  __tests__/voiceChatService.test.ts __tests__/voiceReplyService.test.ts \
  __tests__/firebaseConfigWebVoiceCallable.test.ts
```

- [ ] **Step 3: Remove `generateVoiceReplyFn` from `firebaseConfig.ts`**

In `src/config/firebaseConfig.ts`, delete the const declaration (line 82):

```typescript
const generateVoiceReplyFn = httpsCallable(functionsInstance, 'generateVoiceReply')
```

and the `generateVoiceReplyFn,` entry from the exports block (line 121).

- [ ] **Step 4: Remove `generateVoiceReplyFn` from `firebaseConfig.web.ts`**

In `src/config/firebaseConfig.web.ts`, delete the const declaration (line 137):

```typescript
const generateVoiceReplyFn = httpsCallable(functionsInstance, 'generateVoiceReply')
```

and the `generateVoiceReplyFn,` entry from the exports block (line 178).

- [ ] **Step 5: Typecheck and run the client suite**

Run: `npm run typecheck && npm test`
Expected: pass — no dangling imports of the deleted symbols; deleted tests no longer run.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore(credits): delete dead one-shot voice reply client path

sendVoiceMessage/voiceReplyService/generateVoiceReplyFn had no runtime
caller (Talk moved to live voice). Removes the client half of the
generateVoiceReply chain and its tests.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Delete Dead Voice Path (Firebase Functions)

**Files:**
- Delete: `functions/src/generateVoiceReply.ts`, `functions/src/generateVoiceReply.test.ts`
- Modify: `functions/src/index.ts:9-11`

- [ ] **Step 1: Confirm no non-test references in functions**

Run:

```bash
grep -rn "generateVoiceReply" functions/src | grep -v ".test."
```

Expected: only `functions/src/generateVoiceReply.ts` (self) and the export in `functions/src/index.ts`.

- [ ] **Step 2: Delete the Function and its test**

```bash
git rm functions/src/generateVoiceReply.ts functions/src/generateVoiceReply.test.ts
```

- [ ] **Step 3: Remove the export from `index.ts`**

In `functions/src/index.ts`, remove the `generateVoiceReply` import/export (lines 9-11):

```typescript
import {
  generateVoiceReply,
} from "./generateVoiceReply.js";
```

If `generateVoiceReply` is also listed in an aggregated `export { ... }` block, remove it there too. Verify with:

```bash
grep -n "generateVoiceReply" functions/src/index.ts
```

Expected after edit: no matches.

- [ ] **Step 4: Typecheck, lint, and run the functions suite**

Run: `cd functions && npm run typecheck && npm run lint && npm test`
Expected: pass — `generateVoiceReply.test.ts` no longer runs; no dangling references.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(credits): remove dead generateVoiceReply cloud callable

No client caller remains after the live-voice migration. Removing the
export undeploys the onCall on next Functions deploy, mirroring the
#506 dead-callable cleanup.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Update Billing Documentation

**Files:**
- Modify: `docs/billing-and-credits.md:27`

- [ ] **Step 1: Remove the one-shot voice row**

In `docs/billing-and-credits.md`, delete the Credit Consumption table row (line 27):

```markdown
| One-shot voice reply | `generateVoiceReply` | 2 | Yes |
```

Leave the **Live voice** row (line 31) and the `≥ 2` connect-gate note (line 35) unchanged — they describe the live path, which stays.

- [ ] **Step 2: Verify no other doc references the removed callable**

Run:

```bash
grep -rn "generateVoiceReply" docs
```

Expected: no matches (or only historical spec files under `docs/superpowers/specs/`, which are point-in-time records and stay).

- [ ] **Step 3: Commit**

```bash
git add docs/billing-and-credits.md
git commit -m "docs(credits): drop one-shot voice reply from cost table

The generateVoiceReply path is deleted; remove its Credit Consumption row.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final Verification

- [ ] **Root suite:** `npm run typecheck && npm run lint && npm test` → pass
- [ ] **Functions suite:** `cd functions && npm run typecheck && npm run lint && npm test` → pass
- [ ] **Manual regression:** start a live call → header badge ticks down as minutes bill; after `END_CALL`, badge and `CreditsDisplay` show the post-call balance with no manual Sync; in-call count visible and turns warn-colored at ≤ 5.
- [ ] **Grep clean:** `grep -rn "sendVoiceMessage\|generateVoiceReplyFn\|generateVoiceReplyHandler" src app functions/src` → no matches.
- [ ] **Gate unchanged:** `MIN_CREDITS_FOR_CALL = 2` in `useLiveVoiceChat`; server live-voice gate still `< 2`.
