# Character Voice Selection — Design Spec

**Date:** 2026-04-25
**Status:** Approved

---

## Goal

Persist a `voice` field on characters end-to-end — SQLite, cloud Postgres, and all sync paths — set `Umbriel` as the default voice for newly created characters, and add a voice selector dropdown to the Character Edit screen. This unblocks the Talk tab's press-to-talk flow, which currently alerts "No Voice Set" because no character has a voice configured.

Additionally, align the app with the latest [`expo-audio` docs](https://docs.expo.dev/versions/latest/sdk/audio/) by adding the `expo-audio` config plugin (currently missing from `app.config.ts`) and configuring the audio session at runtime via `setAudioModeAsync`. Without these, voice-reply playback silently misbehaves (no background playback, no explicit silent-mode handling, and microphone permission strings come only from `expo-speech-recognition`).

---

## Architecture

### Problem

The `Character` TypeScript type and `CharacterSnapshot`/`SyncCharacterPayload` client types already include a voice field shape, but:
1. The SQLite schema has no `voice` column — values are silently dropped on every save
2. `CharacterInsert` / `CharacterUpdate` don't include `voice` — the DB layer can't write it
3. `DEFAULT_CHARACTER_INSERT` in `characterMachine.ts` doesn't set `voice`
4. `createNewCharacter()` in `characterService.ts` (used by the "Create Character" button) also has no `voice`
5. The Character Edit screen has no UI to pick a voice
6. Cloud sync silently drops `voice`: `syncUnsyncedToCloud` doesn't include it in the payload, `restoreFromCloud` and `importSharedCharacterFromCloud` don't map it back, the cloud Postgres schema has no `voice` column, and the Drizzle schema and cloud function handler don't handle it
7. `expo-audio` is installed (~55.0.14) and used in `useVoiceChat.ts` (`createAudioPlayer`, `requestRecordingPermissionsAsync`), but no config plugin is registered in `app.config.ts`. Per the latest docs, the plugin is required for declaring the iOS `NSMicrophoneUsageDescription`, Android `RECORD_AUDIO` permission, and the iOS `audio` `UIBackgroundMode` capability needed for sustained background playback of voice replies.
8. The audio session is never configured at runtime — `setAudioModeAsync` is not called, so playback in iOS silent mode is unreliable and background playback won't work even after the plugin is added.

### Approach

Add `voice` to the SQLite schema via a standard migration (v8 → v9), wire it through all data-layer types and functions, propagate it through the entire cloud sync pipeline (Drizzle schema, cloud function handler, sync service), patch both default-character creation paths, and add the picker UI. Register the `expo-audio` config plugin in `app.config.ts` and call `setAudioModeAsync` once on `useVoiceChat` mount. **Adding the config plugin is a native config change and requires a new build (no OTA).**

### New Files

| File | Responsibility |
|---|---|
| `src/constants/geminiVoices.ts` | Typed list of all 30 Gemini TTS voice names + style descriptors; imported by edit screen and tests |
| `functions/drizzle/0003_character_voice.sql` | Cloud Postgres migration: `ALTER TABLE characters ADD COLUMN voice text` |

### Modified Files

| File | Change |
|---|---|
| `src/database/schema.ts` | Bump `SCHEMA_VERSION` to 9; add `voice` to `LATEST_SCHEMA_REQUIRED_COLUMNS`; add migration 9 skip guard; add `ALTER TABLE characters ADD COLUMN voice TEXT` migration |
| `src/database/characterDatabase.ts` | Add `voice` to `LocalCharacter`, `CharacterInsert`, `CharacterUpdate`, `toAppFormat()`, `createCharacter()` INSERT, and `updateCharacter()` SET builder |
| `src/machines/characterMachine.ts` | Add `voice: 'Umbriel'` to `DEFAULT_CHARACTER_INSERT` |
| `src/services/characterService.ts` | Add `voice: 'Umbriel'` to the `createCharacter()` call inside `createNewCharacter()` |
| `src/services/characterSyncService.ts` | Include `voice` in `syncUnsyncedToCloud` payload; map `voice` in `restoreFromCloud` and `importSharedCharacterFromCloud` |
| `functions/src/db/schema.ts` | Add `voice: text('voice')` to the `characters` Drizzle table definition |
| `functions/src/characterFunctions.ts` | Add `voice` to `SyncCharacterPayload` type; parse with `parseOptionalTextField`; pass to `upsertCharacter`; include in `serializeCharacter` output |
| `functions/src/services/characterService.ts` | Add `'voice'` to `CharacterUpdateInput` Pick; handle `voice` in `buildCharacterUpdateValues` |
| `app/(drawer)/(tabs)/characters/[id]/edit.tsx` | Add `voice` state, load from character, include in `handleSave`, include in dirty-state tracking, add dropdown UI |
| `app.config.ts` | Register `expo-audio` config plugin with `microphonePermission`, `enableBackgroundPlayback: true`, `enableBackgroundRecording: false` |
| `src/hooks/useVoiceChat.ts` | Call `setAudioModeAsync` once on mount to configure the audio session |
| `__tests__/editCharacterScreen.test.tsx` | Add tests: voice selector renders, selecting a voice calls `update` with correct value |
| `__tests__/useVoiceChat.test.tsx` | Add test verifying `setAudioModeAsync` is called on mount with the expected mode |

---

## Audio Configuration (expo-audio)

This section brings the app into compliance with the latest `expo-audio` docs and is a prerequisite for the voice-selection UX to actually produce audible replies in all expected conditions (silent mode, app backgrounded mid-playback).

### Config plugin (`app.config.ts`)

Add `expo-audio` to the `plugins` array, alongside the existing `expo-speech-recognition` entry:

```ts
[
  'expo-audio',
  {
    microphonePermission:
      'Allow Clanker to access your microphone for voice conversations.',
    enableBackgroundPlayback: true,
    enableBackgroundRecording: false,
  },
],
```

Rationale per [latest docs](https://docs.expo.dev/versions/latest/sdk/audio/#configurable-properties):
- `microphonePermission` — sets `NSMicrophoneUsageDescription` on iOS. Reuses the same wording as the existing `expo-speech-recognition` permission for consistency. (Decision Q1.)
- `enableBackgroundPlayback: true` — adds the `audio` `UIBackgroundMode` on iOS and the `FOREGROUND_SERVICE` + `FOREGROUND_SERVICE_MEDIA_PLAYBACK` permissions plus the `AudioControlsService` declaration on Android, so a voice reply that started playing keeps playing if the user briefly backgrounds the app.
- `enableBackgroundRecording: false` — Talk tab is foreground-only; we explicitly opt out so we don't add unnecessary `FOREGROUND_SERVICE_MICROPHONE` / `POST_NOTIFICATIONS` permissions or a persistent recording notification.
- `recordAudioAndroid` — left at its default of `true`; the Android `RECORD_AUDIO` permission is also already declared by `expo-speech-recognition`, but having both plugins declare it is harmless (manifest merger dedupes).

**Build impact:** This changes native config and requires a new dev/prod build. It cannot ship as an OTA update.

### Runtime audio mode (`src/hooks/useVoiceChat.ts`)

Import `setAudioModeAsync` from `expo-audio` (alongside the existing `createAudioPlayer` and `requestRecordingPermissionsAsync` imports) and call it once on mount, guarded by `canUseNativeVoice` (web is excluded). Failure is non-fatal — log and continue:

```ts
import {
  createAudioPlayer,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from 'expo-audio'

// inside useVoiceChat, after existing refs/state
useEffect(() => {
  if (!canUseNativeVoice) return
  setAudioModeAsync({
    playsInSilentMode: true,
    allowsRecording: true,
    shouldPlayInBackground: true,
    interruptionMode: 'mixWithOthers',
  }).catch((err) => {
    console.warn('[useVoiceChat] setAudioModeAsync failed', err)
  })
}, [canUseNativeVoice])
```

Rationale per [`AudioMode` docs](https://docs.expo.dev/versions/latest/sdk/audio/#audiomode):
- `playsInSilentMode: true` — voice replies are the primary content of the Talk tab, so they should be audible even with the iOS ringer switch off.
- `allowsRecording: true` — required on iOS for the audio session category to permit microphone access during the recording phase.
- `shouldPlayInBackground: true` — pairs with the plugin's `enableBackgroundPlayback` so the audio session stays active when the app backgrounds.
- `interruptionMode: 'mixWithOthers'` — safe default that doesn't pause the user's music/podcasts. (Decision Q2.) Lock-screen controls are out of scope; if added later this needs to switch to `'doNotMix'` per the `setActiveForLockScreen` docs.

### Permission flow

No changes to the existing `requestRecordingPermissionsAsync()` call in `startListening` — it already follows the docs' recommended pattern. The new config plugin ensures the iOS prompt has a proper rationale string and the Android permission is declared at install time.

---

## Data Layer

### Schema Migration

```
SCHEMA_VERSION = 9

LATEST_SCHEMA_REQUIRED_COLUMNS.characters += 'voice'

MIGRATION_SKIP_GUARDS[9] = { table: 'characters', column: 'voice' }

Migration 9 SQL:
  ALTER TABLE characters ADD COLUMN voice TEXT
```

### Type Changes (`characterDatabase.ts`)

```typescript
// LocalCharacter (raw SQLite row)
voice: string

// CharacterInsert
voice?: string | null

// CharacterUpdate
voice?: string | null

// toAppFormat() addition
voice: char.voice,

// createCharacter() INSERT — add voice column + value
// updateCharacter() SET builder — handle updates.voice
```

---

## Default Character

Two creation paths both get `voice: 'Umbriel'`:

**1. `DEFAULT_CHARACTER_INSERT` in `src/machines/characterMachine.ts`** — the auto-created character on first launch:

```typescript
const DEFAULT_CHARACTER_INSERT: CharacterInsert = {
  name: 'Clanker',
  is_public: false,
  appearance: 'A sturdy mechanical companion with a practical, well-worn chassis.',
  traits: 'Loyal, curious, resourceful, and a little sarcastic.',
  emotions: 'Calm, attentive, and eager to help.',
  context: 'A newly created companion character ready to chat and develop its personality.',
  voice: 'Umbriel',  // ← new
}
```

**2. `createNewCharacter()` in `src/services/characterService.ts`** — the "Create Character" button on the list screen:

```typescript
const character = await createCharacter({
  name: 'Clanker',
  appearance: 'A mysterious figure with an intriguing presence.',
  traits: 'Curious, intelligent, and thoughtful.',
  emotions: 'Calm and collected, with hints of excitement.',
  context: 'A helpful companion ready for meaningful conversations.',
  is_public: false,
  avatar_data: avatarData,
  voice: 'Umbriel',  // ← new
})
```

---

## Voices Constant

New file `src/constants/geminiVoices.ts`:

```typescript
export interface GeminiVoice {
  name: string
  style: string
}

export const GEMINI_VOICES: GeminiVoice[] = [
  { name: 'Zephyr',        style: 'Bright' },
  { name: 'Puck',          style: 'Upbeat' },
  { name: 'Charon',        style: 'Informative' },
  { name: 'Kore',          style: 'Firm' },
  { name: 'Fenrir',        style: 'Excitable' },
  { name: 'Leda',          style: 'Youthful' },
  { name: 'Orus',          style: 'Firm' },
  { name: 'Aoede',         style: 'Breezy' },
  { name: 'Callirrhoe',    style: 'Easy-going' },
  { name: 'Autonoe',       style: 'Bright' },
  { name: 'Enceladus',     style: 'Breathy' },
  { name: 'Iapetus',       style: 'Clear' },
  { name: 'Umbriel',       style: 'Easy-going' },
  { name: 'Algieba',       style: 'Smooth' },
  { name: 'Despina',       style: 'Smooth' },
  { name: 'Erinome',       style: 'Clear' },
  { name: 'Algenib',       style: 'Gravelly' },
  { name: 'Rasalgethi',    style: 'Informative' },
  { name: 'Laomedeia',     style: 'Upbeat' },
  { name: 'Achernar',      style: 'Soft' },
  { name: 'Alnilam',       style: 'Firm' },
  { name: 'Schedar',       style: 'Even' },
  { name: 'Gacrux',        style: 'Mature' },
  { name: 'Pulcherrima',   style: 'Forward' },
  { name: 'Achird',        style: 'Friendly' },
  { name: 'Zubenelgenubi', style: 'Casual' },
  { name: 'Vindemiatrix',  style: 'Gentle' },
  { name: 'Sadachbia',     style: 'Lively' },
  { name: 'Sadaltager',    style: 'Knowledgeable' },
  { name: 'Sulafat',       style: 'Warm' },
]
```

## Cloud Sync

Voice must round-trip through the entire sync pipeline without being dropped.

### Postgres migration (`functions/drizzle/0003_character_voice.sql`)

```sql
ALTER TABLE "characters" ADD COLUMN "voice" text;
```

### Drizzle schema (`functions/src/db/schema.ts`)

Add `voice: text('voice')` to the `characters` table definition (alongside `context`).

### Cloud function handler (`functions/src/characterFunctions.ts`)

1. Include voice in `SyncCharacterPayload` handling
2. Parse and normalize voice (trim + default when blank)
3. Pass normalized voice to `upsertCharacter(...)`
4. `serializeCharacter` spreads the DB row via `...rest` so `voice` flows through automatically once the column exists

### Cloud character service (`functions/src/services/characterService.ts`)

1. Add `'voice'` to `CharacterUpdateInput` Pick type
2. Add `voice: character.voice` to `buildCharacterUpdateValues` return value (unconditional, like other text fields)

### Sync service (`src/services/characterSyncService.ts`)

**`syncUnsyncedToCloud`** — add `voice: char.voice` to the character payload:

```typescript
const result = await syncCharacterFn({
  character: {
    ...(cloudId ? { id: cloudId } : {}),
    name: char.name,
    avatar: char.avatar,
    appearance: char.appearance,
    traits: char.traits,
    emotions: char.emotions,
    context: char.context,
    voice: char.voice,         // ← new
    isPublic: Boolean(char.is_public),
    createdAt: new Date(char.created_at).toISOString(),
    updatedAt: new Date(char.updated_at).toISOString(),
  }
})
```

**`restoreFromCloud`** — normalize cloud voice before local write: trim and fallback to `DEFAULT_VOICE` when null/blank.

**`importSharedCharacterFromCloud`** — normalize cloud voice before local write: trim and fallback to `DEFAULT_VOICE` when null/blank.

---



### State additions

```typescript
const [voice, setVoice] = useState<string>(DEFAULT_VOICE)
const [voiceMenuVisible, setVoiceMenuVisible] = useState(false)
```

### Load from character

In the existing `useEffect` that loads character data:

```typescript
setVoice(character.voice ?? DEFAULT_VOICE)
```

### Dirty-state tracking

Add `voice` to both the `canEdit` branch and the fallback shape passed to `useEditDirtyState`.

Add `voice: character.voice ?? DEFAULT_VOICE` to `loadedValues`.

### handleSave

```typescript
update(id, {
  name,
  appearance,
  traits,
  emotions,
  context,
  save_to_cloud: saveToCloud,
  is_public: saveToCloud ? isCharacterShareable : false,
  voice,  // ← new
})
```

### UI placement

Voice dropdown sits below the `context` field and above the cloud save section, separated by a `Divider`. Uses `react-native-paper` `Menu`:

```
<Text variant="labelLarge">Voice</Text>
<Menu
  visible={voiceMenuVisible}
  onDismiss={() => setVoiceMenuVisible(false)}
  anchor={
    <Button
      mode="outlined"
      onPress={() => canEdit && setVoiceMenuVisible(true)}
      disabled={!canEdit}
    >
      {`${voice} — ${styleFor(voice)}`}
    </Button>
  }
>
  {GEMINI_VOICES.map(v => (
    <Menu.Item
      key={v.name}
      title={`${v.name} — ${v.style}`}
      onPress={() => { setVoice(v.name); setVoiceMenuVisible(false) }}
    />
  ))}
</Menu>
```

`styleFor` is a small helper that looks up the style from `GEMINI_VOICES` by name (used for the button label).

---

## Testing

### `__tests__/editCharacterScreen.test.tsx`

Add to existing test file:

1. **Voice selector renders** — when character has `voice: 'Umbriel'`, the anchor button label contains `'Umbriel'`
2. **Voice selector defaults to Umbriel when missing** — when character voice is absent, the anchor label shows `'Umbriel'`
3. **Selecting a voice calls update with normalized value** — simulate `Menu.Item` press, verify `mockUpdate` called with trimmed voice name

The `Menu` mock in `react-native-paper` mock needs `Menu`, `Menu.Item` added (currently missing).

### `__tests__/characterMachine.test.ts`

Add assertion that `DEFAULT_CHARACTER_INSERT` (or the character created by `createDefaultCharacterActor`) has `voice === 'Umbriel'`.

---

## Error Handling

No new error cases. Characters always persist a normalized non-empty voice value. Input is trimmed and defaults to `DEFAULT_VOICE` when null/blank, so talk flows no longer depend on a runtime missing-voice fallback.

---

## Out of Scope

- Voice preview / audio sample in the picker
- Per-character voice speed / pitch controls
- Lock-screen / Now Playing controls (`setActiveForLockScreen`) — would require switching `interruptionMode` to `'doNotMix'`
- Background recording (`enableBackgroundRecording: true`) — Talk tab is foreground-only
- Android `requestNotificationPermissionsAsync` — only needed if we later show media notifications
- Character mutation race condition in `useVoiceChat` (separate issue)
