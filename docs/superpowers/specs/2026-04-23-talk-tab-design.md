# Talk Tab — Design Spec

**Date:** 2026-04-23
**Status:** Approved

---

## Goal

Add a **Talk** tab to the bottom navigation that lets users have a spoken conversation with their character. The user taps a mic button to speak; their speech is transcribed to text, used to generate a voiced AI reply (via the existing `generateVoiceReply` Cloud Function pipeline), and the audio is played back through the device speaker. Both sides of the conversation are saved to the shared SQLite message store so they appear in the Chat tab.

---

## Architecture

### New Dependencies

All require an **EAS native build** (not OTA-deployable):

| Package | Purpose |
|---|---|
| `expo-speech-recognition` | Tap-to-start STT; auto-stops on silence on iOS + Android |
| `expo-audio` | WAV playback (from temp file written by `expo-file-system`) |
| `expo-file-system` | Already installed; used to write base64 audio to a temp `.wav` for `expo-audio` |

### New Files

| File | Responsibility |
|---|---|
| `app/(drawer)/(tabs)/talk/index.tsx` | Talk screen UI |
| `src/services/voiceChatService.ts` | Orchestrates STT result → prompt build → API call → save messages → return audio |
| `src/hooks/useVoiceChat.ts` | React wrapper around `voiceChatService`, manages local UI state |

### Modified Files

| File | Change |
|---|---|
| `app/(drawer)/(tabs)/_layout.tsx` | Add Talk tab (mic icon) between Chat and Characters |
| `app.config.ts` | Add `expo-speech-recognition` plugin config with iOS `microphonePermission` + `speechRecognitionPermission` strings; ensure Android `RECORD_AUDIO` permission |
| `src/services/aiChatService.ts` | Export `buildChatPrompt` and `getRecentConversationHistory` so `voiceChatService` can reuse them |
| `src/components/LandingPage/FeaturesSection.tsx` | Add Talk feature tile to `FEATURES` array |
| `app/support.tsx` | Add FAQ entry: "How do voice replies work and what do they cost?" |
| `plan.md` | Updated plan: Task 9 revised + new Task 11 added |

---

## Screen Layout

### Structure

```
┌──────────────────────────────────┐
│  [Stack header: avatar + name]   │  ← same as Chat header
├──────────────────────────────────┤
│                                  │
│          (empty space)           │
│                                  │
│  ┌────────────────────────────┐  │
│  │   transcription / reply    │  │  ← status text area
│  └────────────────────────────┘  │
│                                  │
│       ●  ← mic button            │  ← centered, bottom quarter
│                                  │
└──────────────────────────────────┘
```

- The **top area** mirrors the Chat header: `CharacterAvatar` (tappable → navigates to edit) + character name.
- The **status text area** is a single non-editable text block above the mic button.
- The **mic button** is a green filled circle (~80dp), centered horizontally, positioned in the bottom quarter of the screen.

### Visual States

| State | Button | Button glow | Avatar glow | Status text |
|---|---|---|---|---|
| `idle` | Green circle, mic icon | ✗ | ✗ | `""` (empty) |
| `listening` | Green circle, mic icon | ✓ pulsing glow | ✗ | `"Listening..."` |
| `transcribing` | Disabled, spinner | ✗ | ✗ | Live transcription text |
| `processing` | Disabled, spinner | ✗ | ✗ | Transcription (locked) |
| `playing` | Disabled, speaker icon | ✗ | ✓ pulsing glow | `replyText` from API |
| `error` | Green circle, mic icon | ✗ | ✗ | Error message (red) |

**Glow implementation:** `react-native-reanimated` `withRepeat(withSequence(withTiming(1, ...), withTiming(0, ...)), -1)` — same pattern already used in `src/components/LandingPage/HeroSection.tsx`. The glow is rendered as a semi-transparent colored `View` behind the button/avatar with `borderRadius` matching the element. The shared values are reset (`cancelAnimation` + `value = 0`) on state transitions out of `listening`/`playing` and on screen unmount to avoid orphaned worklets.

**Avatar tap behavior:** The header avatar is tappable only when `voiceState === 'idle'`. In any other state the tap is a no-op (no navigation) so the user does not leave mid-flow.

**Error state retry:** From `error`, tapping the mic button clears `error` and starts a new STT session (same path as from `idle`).

### Credit Costs

| Plan | Credits per voice reply |
|---|---|
| Monthly subscriber (`monthly_20`, `monthly_50`) | 0 (unlimited) |
| Non-subscriber (`payg`, `free`, etc.) | 2 |

Credit cost is not displayed on the Talk screen. It is documented in the FAQ (see `app/support.tsx`) and discoverable via the Landing page feature tile.

**Insufficient-credits gate:** On mic button tap, if `!isSubscriber && remainingCredits < 2`:
- Show `Alert.alert('Insufficient Credits', 'Voice replies cost 2 credits. Purchase more or subscribe for unlimited.', [{ text: 'Cancel' }, { text: 'Get More', onPress: () => router.push('/subscribe') }])`
- Do not start STT.

---

## Data Flow

```
1. User taps mic button
   → voice-null check (Alert + return if character.voice === null)       [cheapest first]
   → credit pre-flight: if !isSubscriber && remainingCredits < 2
       → Alert 'Insufficient Credits', return
   → permission check: ExpoSpeechRecognitionModule.requestPermissionsAsync()
       → if denied → state: error, status text: 'Microphone permission required.
         Enable it in Settings.'; mic stays tappable for retry
   → ExpoSpeechRecognitionModule.start({ lang: 'en-US', interimResults: true })
   → state: listening (mic button glows)
   → start MAX_LISTEN_MS (30s) safety timer; on fire → ExpoSpeechRecognitionModule.stop()

2. Live transcription events update status text
   → state: transcribing

3. Silence detected (or safety timer fires) → recognition ends automatically (no second tap required)
   → if final transcript is empty/whitespace → state: idle, no API call
   → else → state: processing (transcription text locked)

4. voiceChatService.sendVoiceMessage(transcribedText, character, userId, conversationHistory)
   a. sendMessage(character.id, userId, transcribedText)       → saves user message to SQLite
   b. buildChatPrompt(transcribedText, { characterName, characterPersonality,
                                         characterTraits, conversationHistory })
      → assembles full prompt (same function as Chat)
   c. generateVoiceReply({ prompt, characterVoice: character.voice,
                           characterTraits, characterEmotions, referenceId })
      → { replyText, rawReplyText, audioBase64, audioMimeType, ... }
   d. saveAIMessage(character.id, userId, replyText)            → saves AI reply to SQLite
   e. triggerConversationSummary(character, userId)             → same as Chat (fire-and-forget)
   f. return { audioBase64, audioMimeType, replyText, usageSnapshot }

5. Write audioBase64 to a temp file (FileSystem.cacheDirectory + 'voice-reply-<ts>.wav',
   base64 encoding), then createAudioPlayer({ uri }).play()
   → state: playing (avatar glows)
   → on playback end (or error) → release player, delete temp file, state: idle
```

### Audio Playback Detail

`expo-audio` has no `playFromBase64` helper. The hook owns the full lifecycle:

1. `const path = `${FileSystem.cacheDirectory}voice-reply-${Date.now()}.wav``
2. `await FileSystem.writeAsStringAsync(path, audioBase64, { encoding: FileSystem.EncodingType.Base64 })`
3. `const player = createAudioPlayer({ uri: path })`
4. Subscribe to `playbackStatusUpdate`; on `didJustFinish` or unmount/cancel: `player.release()` + `FileSystem.deleteAsync(path, { idempotent: true })`.

### Mid-Flow Unmount / Cancel

If the user navigates away or calls `cancel()` while a flow is in progress:

- `listening`/`transcribing`: stop STT immediately; do not call API; return to `idle`.
- `processing`: the in-flight `sendVoiceMessage` is allowed to complete (user + AI messages still saved so Chat history is consistent); audio playback is **skipped** if the screen is unmounted.
- `playing`: stop the player, release it, delete the temp file; messages remain saved.

The hook tracks an `isMountedRef` and a `cancelledRef` and gates the playback step on both.

### Character Has No Voice Set

If `character.voice` is `null` (voice not configured). Checked first (before credit pre-flight):
- Show `Alert.alert('No Voice Set', 'This character has no voice selected. Go to character settings to choose one.', [{ text: 'OK' }, { text: 'Edit Character', onPress: () => router.push(\`/characters/${characterId}/edit\`) }])`
- Do not start STT.

---

## Message History Integration

Voice exchanges use the **same SQLite message table and React Query cache** as Chat. The query key is `messageKeys.list(characterId, userId)` — already used by Chat. When the user switches tabs, Chat shows the full history including voice turns as plain text.

The `voiceChatService` calls `invalidateQueries({ queryKey: messageKeys.list(...) })` after saving, so both tabs stay in sync.

---

## `voiceChatService.ts` Interface

```typescript
export interface VoiceChatResult {
  audioBase64: string
  audioMimeType: string
  replyText: string
  usageSnapshot: UsageSnapshot | null
}

export async function sendVoiceMessage(
  transcribedText: string,
  character: Character,
  userId: string,
  conversationHistory: IMessage[],
): Promise<VoiceChatResult>
```

---

## `useVoiceChat.ts` Interface

```typescript
type VoiceState = 'idle' | 'listening' | 'transcribing' | 'processing' | 'playing' | 'error'

interface UseVoiceChatReturn {
  voiceState: VoiceState
  transcription: string
  replyText: string
  error: string | null
  startListening: () => void  // tap mic → start STT; recognition ends automatically on silence
  cancel: () => void          // abort mid-flow (listening/processing/playing) → idle; stops audio
}

export function useVoiceChat(characterId: string): UseVoiceChatReturn
```

Internally `useVoiceChat`:
- Reads `conversationHistory` from React Query via `getRecentConversationHistory(characterId, userId)` (the same selector Chat uses) so the prompt includes recent turns.
- Reads `isSubscriber` and `remainingCredits` from `useCurrentPlan` for the pre-flight gate.
- Owns the `MAX_LISTEN_MS` safety timer, permission request, temp-file lifecycle, and reanimated cleanup described above.

---

## Plan Changes

### Task 9 Revision (`generateVoiceReply` Cloud Function)

The `prompt` field in the Cloud Function request receives the **fully assembled `buildChatPrompt` output** (same format as `generateReply`). No change to the function's server-side interface is needed — the client (voiceChatService) is responsible for building the prompt before calling the function.

**Billing:** Voice costs more than text due to TTS generation. Server-side rules:
- Unlimited tiers (`monthly_20`, `monthly_50`): 0 credits.
- All other tiers: **2 credits** (require `creditBalance >= 2` before generation; spend 2 after successful generation).
- `assertUsageAuthorized` must check `creditBalance < 2` (not `< 1`) for voice.
- `creditsSpent` in the response will be `0` (unlimited) or `2` (non-unlimited).

### New Task 11 (Talk Screen)

Covers:
1. Install `expo-speech-recognition` + `expo-audio`
2. Add `expo-speech-recognition` plugin block to `app.config.ts` with iOS permission strings
   (`microphonePermission`, `speechRecognitionPermission`) and Android `RECORD_AUDIO`
3. Export `buildChatPrompt` + `getRecentConversationHistory` from `aiChatService.ts`
4. Create `voiceChatService.ts` with tests
5. Create `useVoiceChat.ts` (owns permission request, MAX_LISTEN_MS timer, temp-file
   playback lifecycle, reanimated cleanup, mid-flow cancel)
6. Create `talk/index.tsx`
7. Register Talk tab in `_layout.tsx`
8. Add Talk tile to `FeaturesSection.tsx` `FEATURES` array:
   - icon: `'microphone-outline'`
   - title: `'Talk to Your Character'`
   - body: `'Tap the mic and speak — your character replies in their own voice. Monthly subscribers talk for free; others use 2 credits per reply.'`
9. Add FAQ entry to `app/support.tsx` (after the credits/subscriptions entry):
   - **Q:** `"How do voice replies work and what do they cost?"`
   - **A:** `"Open the Talk tab, tap the mic, and speak. Your character replies out loud in their chosen voice. Monthly subscribers get unlimited voice replies. Pay-as-you-go users spend 2 credits per reply."`
10. Tests:
    - no-voice gate (character.voice null → Alert, no STT)
    - insufficient-credits gate (non-subscriber, 1 credit → Alert, no STT)
    - non-subscriber with 2 credits → proceeds
    - monthly subscriber with 0 credits → proceeds (unlimited)
    - permission denied → error state with retry-on-tap
    - empty transcription → return to idle, no API call
    - MAX_LISTEN_MS timer fires → STT stops, normal post-processing
    - full happy-path flow (incl. temp-file write + playback)
    - mid-flow unmount during `processing` → messages saved, playback skipped, temp file cleaned
    - cancel() during `playing` → player released, temp file deleted
    - audio playback failure → error state, temp file cleaned

---

## EAS Build Note

`expo-speech-recognition` and `expo-audio` are native modules. The Talk tab will silently fall back (button disabled with a tooltip) on web. The next EAS build after this feature branch merges to staging will activate voice for iOS and Android.

---

## Non-Goals

- Web support for voice input/output (native only)
- Wake word / always-listening mode
- Transcript history displayed on the Talk screen (stateless UI per session)
- Recording and saving the user's raw audio
