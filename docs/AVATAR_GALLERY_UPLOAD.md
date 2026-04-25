# Avatar Gallery Upload

## Overview

Character edit screen supports local avatar upload from photo library with no cloud call and no credit deduction.

Flow:

1. User taps **Upload Photo** on character edit screen.
2. App opens gallery picker via `expo-image-picker`.
3. Selected image is validated and converted to WebP via `expo-image-manipulator`.
4. Converted file is read as base64 and saved to SQLite `avatar_data` using local image service.
5. Returned data URI is set as character avatar in UI.

## Constraints

- Minimum source image size: `200x200`.
- Maximum output dimensions: `1024x1024` (aspect ratio preserved).
- Output mime type: `image/webp`.

## Error Handling

- Picker cancel returns `null` and leaves error empty.
- Permission-related picker errors surface as `Photo library access denied`.
- Images below minimum size fail with `Image too small. Minimum size is 200×200 pixels.`.
- Manipulation or SQLite errors surface raw message in edit screen helper text.

## Platform Notes

- iOS usage strings configured in app config:
  - `ios.infoPlist.NSPhotoLibraryUsageDescription`
  - `expo-image-picker` plugin `photosPermission`
- Web uses browser file picker provided by `expo-image-picker`.
