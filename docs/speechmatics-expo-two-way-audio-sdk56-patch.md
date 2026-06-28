# Patch: `@speechmatics/expo-two-way-audio` — Expo SDK 56 iOS Build Fix

## Problem

iOS simulator builds fail with exit status 65 during `Run fastlane` when `@speechmatics/expo-two-way-audio@0.1.2` is installed alongside `expo-modules-core@56.x`.

Two Swift compilation errors surface:

### 1. Type mismatch — `ExpoTwoWayAudioModule.swift` line 125

```text
cannot convert value of type 'Promise.ResolveClosure' (aka '(JavaScriptValue) -> ()') to expected argument type 'EXPromiseResolveBlock'
```

`EXPermissionsMethodsDelegate.getPermissionWithPermissionsManager` and `askForPermission` are Objective-C methods that expect `EXPromiseResolveBlock` (`(Any?) -> Void`). The package passes `promise.resolver`, which is `Promise.ResolveClosure` (`(JavaScriptValue) -> Void`) — a different type added in SDK 55 when Expo rewired promises through Swift/C++ JSI interop.

### 2. Missing symbols — `MicrophonePermissionRequester.swift` line 18

```text
cannot find 'EXFatal' in scope
cannot find 'EXErrorWithMessage' in scope
```

`EXFatal` and `EXErrorWithMessage` are legacy Objective-C macros from the old `UMCore` / `EXCore` era. They are no longer bridged into Swift scope as of Expo SDK 55+.

## Root Cause

`@speechmatics/expo-two-way-audio@0.1.2` was written against an older Expo Modules API. Expo SDK 56 (`expo-modules-core@56.x`) introduced direct Swift/C++ JSI interop, which changed `Promise.resolver` from an `EXPromiseResolveBlock`-compatible type to a JSI-native `ResolveClosure`. The legacy ObjC macros were simultaneously removed from Swift scope.

Upstream PR: [speechmatics/expo-two-way-audio#15](https://github.com/speechmatics/expo-two-way-audio/pull/15) (open, not yet merged/released).

## Fix

`expo-modules-core@56.x` retains a `legacyResolver` bridge property on `Promise` specifically for ObjC delegates not yet converted to Swift:

```swift
// expo-modules-core/ios/Core/Promise.swift
public var legacyResolver: EXPromiseResolveBlock {
    return { value in resolve(value) }
}
```

### `ExpoTwoWayAudioModule.swift` — both `AsyncFunction` blocks

```swift
// before
resolve: promise.resolver,

// after
resolve: promise.legacyResolver,
```

`promise.legacyRejecter` (already used) is unchanged.

### `MicrophonePermissionRequester.swift` — lines 18–22

```swift
// before
EXFatal(EXErrorWithMessage("""
  This app is missing NSMicrophoneUsageDescription, so audio services will fail.
  Add one of these keys to your bundle's Info.plist.
"""))
return ["status": EXPermissionStatusDenied]

// after
fatalError("This app is missing NSMicrophoneUsageDescription, so audio services will fail. Add this key to your bundle's Info.plist.")
```

`NSMicrophoneUsageDescription` missing is a developer error caught at build/review time, so `fatalError` correctly mirrors the original intent.

## Patch

Changes are persisted via `patch-package`:

```text
patches/@speechmatics+expo-two-way-audio+0.1.2.patch
```

Applied automatically on `npm install` via the `postinstall` script in `package.json`:

```json
"postinstall": "patch-package"
```

When `@speechmatics/expo-two-way-audio` ships a release that supports Expo SDK 56, remove the patch file and the `postinstall` entry (if no other patches remain).
