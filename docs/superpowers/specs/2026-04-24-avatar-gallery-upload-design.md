# Avatar Gallery Upload — Design Spec

## Overview

Let users set a character avatar from their device photo library. The image is
converted to WebP (same format as AI-generated avatars) and stored in SQLite
`avatar_data` — same local-only path used today. No credits spent. No cloud call.

---

## Architecture

New hook `useAvatarUpload` mirrors the shape of `useImageGeneration`. It:
1. Launches `expo-image-picker` library picker (no camera).
2. Validates the selected image is at least 200×200 px.
3. Converts result to WebP via `expo-image-manipulator`, resizing down to a
   1024 px maximum dimension if the image exceeds that threshold.
4. Reads the converted file URI → base64 via `new File(uri).base64()`.
5. Calls existing `saveCharacterImageLocally(characterId, base64, 'image/webp')`.
6. Sends a `LOAD` event to the character machine so the updated avatar is
   reflected immediately in the UI.
7. Returns a data URI and calls `onImageUploaded` callback (parallel to
   `onImageGenerated` in `useImageGeneration`).
8. Cleans up the temp WebP file written by `manipulateAsync`.

The edit screen adds one new "Upload Photo" button beside the existing
Generate/Regenerate button.

---

## Packages Required

Both are Expo SDK packages (no bare native module installs needed beyond
`expo install`):

- `expo-image-picker` — gallery picker
- `expo-image-manipulator` — WebP conversion

---

## File Map

| Action | Path |
|--------|------|
| **Create** | `src/hooks/useAvatarUpload.ts` |
| **Create** | `__tests__/useAvatarUpload.test.ts` |
| **Modify** | `app/(drawer)/(tabs)/characters/[id]/edit.tsx` |
| **Modify** | `app.config.ts` — add `NSPhotoLibraryUsageDescription` to `ios.infoPlist`, add `expo-image-picker` plugin |
| **Modify** | `package.json` / `package-lock.json` — via `npx expo install` |

---

## Hook Interface

```typescript
// src/hooks/useAvatarUpload.ts

interface UseAvatarUploadProps {
  characterId: string
  onImageUploaded?: (dataUri: string) => void
}

interface UseAvatarUploadReturn {
  uploadAvatar: () => Promise<string | null>
  isUploading: boolean
  error: string | null
  clearError: () => void
}
```

---

## Hook Implementation Sketch

```typescript
import { useState } from 'react'
import { File } from 'expo-file-system'
import * as ImagePicker from 'expo-image-picker'
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator'
import { useCharacterMachine } from '~/hooks/useMachines'
import { saveCharacterImageLocally } from '~/services/localImageStorageService'

const MIN_IMAGE_DIMENSION = 200
const MAX_IMAGE_DIMENSION = 1024

export function useAvatarUpload({
  characterId,
  onImageUploaded,
}: UseAvatarUploadProps): UseAvatarUploadReturn {
  const characterService = useCharacterMachine()
  const [isUploading, setIsUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const clearError = () => setError(null)

  const uploadAvatar = async (): Promise<string | null> => {
    setIsUploading(true)
    setError(null)

    try {
      const pickerResult = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 1,
      })

      if (pickerResult.canceled) {
        return null
      }

      const [asset] = pickerResult.assets
      if (!asset) throw new Error('No image selected')

      const { uri: sourceUri, width, height } = asset

      // Enforce minimum dimensions
      if (width < MIN_IMAGE_DIMENSION || height < MIN_IMAGE_DIMENSION) {
        throw new Error('Image too small. Minimum size is 200×200 pixels.')
      }

      // Resize down if larger than 1024 px on either axis; otherwise no resize
      const actions =
        width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION
          ? [{ resize: width >= height ? { width: MAX_IMAGE_DIMENSION } : { height: MAX_IMAGE_DIMENSION } }]
          : []

      const manipulated = await manipulateAsync(sourceUri, actions, {
        format: SaveFormat.WEBP,
        compress: 0.9,
      })

      // Read file as base64 using the expo-file-system File API
      const base64 = await new File(manipulated.uri).base64()
      const dataUri = await saveCharacterImageLocally(characterId, base64, 'image/webp')

      // Refresh character machine so the new avatar is visible immediately
      characterService.send({ type: 'LOAD' })

      onImageUploaded?.(dataUri)

      // Clean up temp WebP file created by manipulateAsync
      try {
        new File(manipulated.uri).delete()
      } catch (cleanupErr) {
        console.warn('Failed to clean up temp avatar file:', cleanupErr)
      }

      return dataUri
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to upload image'
      // Permission denial surfaces as a thrown error from launchImageLibraryAsync
      if (message.toLowerCase().includes('permission')) {
        setError('Photo library access denied')
      } else {
        setError(message)
      }
      return null
    } finally {
      setIsUploading(false)
    }
  }

  return { uploadAvatar, isUploading, error, clearError }
}
```

> **Note:** `expo-image-picker` on iOS 14+ does NOT require upfront
> `requestMediaLibraryPermissionsAsync`. The OS presents the limited-access
> picker automatically when you call `launchImageLibraryAsync`. No explicit
> permission request call needed.

---

## Edit Screen Changes

In `app/(drawer)/(tabs)/characters/[id]/edit.tsx`:

1. Wire up `useAvatarUpload` hook (same call site as `useImageGeneration`).
2. Add "Upload Photo" button next to Generate/Regenerate button.
3. Button shows loading spinner when `isUploading`.
4. On success, `setAvatarUri(dataUri)` — same state path as AI generation.
5. Show `uploadError` in the same error Snackbar as `imageError`.

```tsx
const {
  uploadAvatar,
  isUploading,
  error: uploadError,
  clearError: clearUploadError,
} = useAvatarUpload({
  characterId: id || '',
  onImageUploaded: (dataUri) => setAvatarUri(dataUri),
})

// Button (add beside existing Generate button):
<Button
  mode="outlined"
  icon="image-plus"
  onPress={uploadAvatar}
  disabled={isUploading || isGenerating || !canEdit}
  loading={isUploading}
>
  Upload Photo
</Button>
```

Error display: fold `uploadError` into the existing `imageError` Snackbar
(show whichever is non-null).

---

## app.config.ts Changes

Add `NSPhotoLibraryUsageDescription` to `ios.infoPlist` and the
`expo-image-picker` plugin entry:

```typescript
ios: {
  // ...existing keys...
  infoPlist: {
    NSPhotoLibraryUsageDescription:
      'Allow Clanker to access your photo library to set a character avatar.',
  },
},

plugins: [
  // ...existing plugins...
  [
    'expo-image-picker',
    {
      photosPermission:
        'Allow Clanker to access your photo library to set a character avatar.',
    },
  ],
],
```

---

## Tests (`__tests__/useAvatarUpload.test.ts`)

Mock targets:
- `expo-image-picker` → `launchImageLibraryAsync`
- `expo-image-manipulator` → `manipulateAsync`
- `expo-file-system` → `File` (mock `base64()` and `delete()` instance methods)
- `~/hooks/useMachines` → `useCharacterMachine` (mock `send`)
- `~/services/localImageStorageService` → `saveCharacterImageLocally`

Test cases:

| # | Scenario | Expected |
|---|----------|----------|
| 1 | User cancels picker | `uploadAvatar` returns `null`, `saveCharacterImageLocally` not called, no error set |
| 2 | Happy path (image within limits) | `manipulateAsync` called with no resize actions + `SaveFormat.WEBP`, `File.base64()` called, `saveCharacterImageLocally` called with base64 + `'image/webp'`, `characterService.send({ type: 'LOAD' })` called, returned dataUri passed to `onImageUploaded`, `isUploading` resets to false |
| 3 | Happy path (image > 1024 px wide) | `manipulateAsync` called with `[{ resize: { width: 1024 } }]` resize action |
| 4 | Image too small (< 200×200) | `error` set to `'Image too small. Minimum size is 200×200 pixels.'`, returns `null` |
| 5 | `manipulateAsync` throws | `error` set to message, `saveCharacterImageLocally` not called, returns `null` |
| 6 | `saveCharacterImageLocally` throws | `error` set to message, returns `null` |
| 7 | `launchImageLibraryAsync` throws with "permission" in message | `error` set to `'Photo library access denied'`, returns `null` |
| 8 | `isUploading` is true during async operation, false after | verify state transitions |

---

## Out of Scope

- Cropping UI (user uploads as-is)
- Web platform (gallery picker is native-only; web already has no AI generation UI either)
- Credit deduction
- Cloud storage
- User profile avatar (separate feature)
