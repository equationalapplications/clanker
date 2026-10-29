# SUPERSEDED: speechmatics two-way-audio SDK 56 patch (retired 2026-10-29, clanker #857)

**This document is retired.** `patches/@speechmatics+expo-two-way-audio+0.1.2.patch`
no longer exists. The npm dependency `@speechmatics/expo-two-way-audio` was
removed and the fork now lives in source as the vendored local Expo module
**`modules/expo-two-way-audio`**, which exposes **`bargeIn()`** instead of the
forked `restart()`.

Where things went:

- The SDK 56 iOS compile fixes described below are carried **permanently in
  the vendored module's sources** (no patch-package involvement):
  - the `promise.legacyResolver` swaps in `ExpoTwoWayAudioModule.swift` —
    **no upstream PR exists for these**; one must be filed on the
    contribution track (the attribution below to speechmatics PR #15 was
    **wrong** — see the correction),
  - the `MicrophonePermissionRequester.swift` `EXFatal` → `fatalError`
    change, which is exactly upstream
    [speechmatics/expo-two-way-audio#15](https://github.com/speechmatics/expo-two-way-audio/pull/15)
    (open; its diff touches only `MicrophonePermissionRequester.swift`).
- The Android barge-in fork (generation/abort playback loop,
  `clearPlaybackQueueForBargeIn()`) plus EA's `bargeIn()` API and a
  lost-wakeup race fix also live in the vendored module. Upstream
  contribution is planned as two PRs: (a) a concurrency fix
  (`@Volatile` + queue locking + race fix), (b) a `bargeIn` feature PR.
- If the app ever re-syncs with an upstream release, diff against the
  vendored module first — EA's copy intentionally differs (barge-in API, no
  `restart`, race fix).

Correction to the original text (preserved in git history — path
`docs/speechmatics-expo-two-way-audio-sdk56-patch.md`, pre-2026-10-29): it
attributed **both** SDK 56 errors to upstream PR #15. #15 covers **only**
the `MicrophonePermissionRequester` hunk; the `legacyResolver` fix has no
upstream PR.

The original document is preserved in git history (path:
`docs/speechmatics-expo-two-way-audio-sdk56-patch.md`, pre-2026-10-29).
