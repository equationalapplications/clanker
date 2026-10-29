# expo-two-way-audio (vendored local Expo module)

Vendored from [`@speechmatics/expo-two-way-audio@0.1.2`](https://github.com/speechmatics/expo-two-way-audio)
(MIT) with Equational Applications' behavioral fork applied **in source**,
replacing `patches/@speechmatics+expo-two-way-audio+0.1.2.patch` (deleted;
see clanker#857 and `docs/speechmatics-expo-two-way-audio-sdk56-patch.md`).

## Differences from upstream 0.1.2

1. **`bargeIn()` instead of the forked `restart()`** — flushes queued
   playback immediately (AudioTrack pause/flush/play on Android,
   speechPlayer stop/reset on iOS), bumps the playback generation, and
   **keeps the mic/engine alive**. Emits no events. The native
   `Function("restart")` is deleted on both platforms; upstream's
   `resumeRecordingAndPlayer()` semantics are not exposed.
2. **Android concurrency hardening** — `@Volatile` flags, generation-checked
   playback loop, `synchronized` queue access, and a fixed lost-wakeup race
   (a chunk enqueued after the loop's last `poll()` is now guaranteed to be
   consumed or to start a new loop; the start decision and the `isPlaying`
   claim happen under the queue lock).
3. **iOS Expo Modules compile fixes** (SDK 55+/56): `promise.legacyResolver`
   swaps (no upstream PR yet — file one on the contribution track) and the
   `MicrophonePermissionRequester` `fatalError` on missing
   `NSMicrophoneUsageDescription` (matches upstream PR #15).

The single app call site is `src/native/twoWayAudioAdapter.ts`
(`clearPlaybackQueue()` → `bargeIn()`).

## Scope

Only `src/` (JS), `android/`, `ios/` (incl. `ExpoTwoWayAudio.podspec`),
`expo-module.config.json`, and this README are maintained. Everything else
from the upstream tarball (examples, upstream tests, biome config) is
intentionally not vendored.
