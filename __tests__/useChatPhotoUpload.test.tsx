import { renderHook, act } from '@testing-library/react-native'
import { Image } from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import { useChatPhotoUpload } from '~/hooks/useChatPhotoUpload'
import { prepareImageVariants } from '~/services/imageVariants'

jest.mock('expo-image-picker')
// Tests flip isDevice per case; `missing` simulates a dev client built before
// expo-device shipped, where requiring the module throws at evaluation. The
// hook reads `isDevice` inside its try/catch, so a throwing getter exercises
// the same detection-failure path.
const mockDeviceState = { isDevice: true, missing: false }
jest.mock('expo-device', () => ({
  __esModule: true,
  get isDevice(): boolean {
    if (mockDeviceState.missing) {
      throw new Error("Cannot find native module 'ExpoDevice'")
    }
    return mockDeviceState.isDevice
  },
}))
jest.mock('~/services/imageVariants')

// Image.getSize pulls from a native module; stub it directly rather than
// re-importing react-native (which forces TurboModuleRegistry to load the
// whole RN runtime, including modules that aren't wired up in Jest).
const mockGetSize = jest.fn()
;(Image as unknown as { getSize: typeof mockGetSize }).getSize = mockGetSize

const VARIANTS = {
  master: { base64: 'MASTER', mimeType: 'image/webp' as const },
  thumb: { base64: 'THUMB', mimeType: 'image/webp' as const },
}

beforeEach(() => {
  jest.resetAllMocks()
  mockDeviceState.isDevice = true
  mockDeviceState.missing = false
  ;(prepareImageVariants as jest.Mock).mockResolvedValue(VARIANTS)
  ;(ImagePicker.requestCameraPermissionsAsync as jest.Mock).mockResolvedValue({
    granted: true,
    canAskAgain: true,
  })
  ;(ImagePicker.requestMediaLibraryPermissionsAsync as jest.Mock).mockResolvedValue({
    granted: true,
    canAskAgain: true,
  })
  ;(ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({
    canceled: true,
    assets: [],
  })
})

it('fails with a device-required message on the iOS simulator instead of crashing', async () => {
  mockDeviceState.isDevice = false
  const { result } = renderHook(() => useChatPhotoUpload())

  let photo: unknown
  await act(async () => {
    photo = await result.current.captureFromCamera()
  })

  expect(photo).toBeNull()
  expect(result.current.error).toMatch(/physical iOS device/)
  expect(ImagePicker.requestCameraPermissionsAsync).not.toHaveBeenCalled()
  expect(ImagePicker.launchCameraAsync).not.toHaveBeenCalled()
})

it('fails closed on iOS when the expo-device native module is missing', async () => {
  // Dev clients built before expo-device shipped throw at module evaluation.
  // The hook must block iOS capture instead of falling through to the
  // uncatchable simulator crash — even though detection is impossible.
  mockDeviceState.missing = true
  const { result } = renderHook(() => useChatPhotoUpload())

  let photo: unknown
  await act(async () => {
    photo = await result.current.captureFromCamera()
  })

  expect(photo).toBeNull()
  expect(result.current.error).toMatch(/not available in this build/)
  expect(ImagePicker.requestCameraPermissionsAsync).not.toHaveBeenCalled()
  expect(ImagePicker.launchCameraAsync).not.toHaveBeenCalled()
})

it('builds a photo message from a picked asset without cropping it', async () => {
  const { result } = renderHook(() => useChatPhotoUpload())

  const photo = await act(async () =>
    result.current.prepareFromAsset({
      uri: 'file:///landscape.jpg',
      width: 1600,
      height: 900,
    }),
  )

  expect(prepareImageVariants).toHaveBeenCalledWith({
    uri: 'file:///landscape.jpg',
    width: 1600,
    height: 900,
  })
  expect(photo).toEqual({
    imageId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    messageId: expect.stringMatching(/^msg_/),
    uri: 'file:///landscape.jpg',
    width: 1600,
    height: 900,
    variants: VARIANTS,
    attachment: { mimeType: 'image/webp', data: 'MASTER' },
  })
})

it('rejects an encode that exceeds the wire cap instead of sending a doomed request', async () => {
  ;(prepareImageVariants as jest.Mock).mockResolvedValue({
    master: { base64: 'A'.repeat(1_400_001), mimeType: 'image/webp' },
    thumb: { base64: 'THUMB', mimeType: 'image/webp' },
  })
  const { result } = renderHook(() => useChatPhotoUpload())

  await act(async () => {
    await expect(
      result.current.prepareFromAsset({ uri: 'file:///huge.jpg', width: 4000, height: 3000 }),
    ).rejects.toThrow(/too large/i)
  })
})

it('surfaces a denied camera permission as an error without launching the camera', async () => {
  ;(ImagePicker.requestCameraPermissionsAsync as jest.Mock).mockResolvedValue({
    granted: false,
    canAskAgain: true,
  })
  const { result } = renderHook(() => useChatPhotoUpload())

  let photo: unknown
  await act(async () => {
    photo = await result.current.captureFromCamera()
  })

  expect(photo).toBeNull()
  expect(result.current.error).toBe('Camera access denied')
  expect(ImagePicker.launchCameraAsync).not.toHaveBeenCalled()
})

it('points to device settings when the camera is permanently denied', async () => {
  ;(ImagePicker.requestCameraPermissionsAsync as jest.Mock).mockResolvedValue({
    granted: false,
    canAskAgain: false,
  })
  const { result } = renderHook(() => useChatPhotoUpload())

  let photo: unknown
  await act(async () => {
    photo = await result.current.captureFromCamera()
  })

  expect(photo).toBeNull()
  expect(result.current.error).toMatch(/device settings/)
  expect(ImagePicker.launchCameraAsync).not.toHaveBeenCalled()
})

it('returns null when the camera is cancelled', async () => {
  ;(ImagePicker.launchCameraAsync as jest.Mock).mockResolvedValue({ canceled: true, assets: [] })
  const { result } = renderHook(() => useChatPhotoUpload())

  let photo: unknown
  await act(async () => {
    photo = await result.current.captureFromCamera()
  })

  expect(photo).toBeNull()
  expect(result.current.error).toBeNull()
})

it('resolves dimensions via Image.getSize when the caller supplies 0/unknown', async () => {
  // DocumentPicker can return assets with no dimensions; without resolving
  // them, prepareImageVariants skips its resize stage and the master can blow
  // past MAX_ATTACHMENT_BASE64_CHARS. Image.getSize reads just the header.
  mockGetSize.mockImplementation((_uri: string, success: (w: number, h: number) => void) =>
    success(2048, 1536),
  )

  const { result } = renderHook(() => useChatPhotoUpload())

  const photo = await act(async () =>
    result.current.prepareFromAsset({ uri: 'file:///no-dims.jpg', width: 0, height: 0 }),
  )

  expect(mockGetSize).toHaveBeenCalledWith(
    'file:///no-dims.jpg',
    expect.any(Function),
    expect.any(Function),
  )
  expect(prepareImageVariants).toHaveBeenCalledWith({
    uri: 'file:///no-dims.jpg',
    width: 2048,
    height: 1536,
  })
  expect(photo.width).toBe(2048)
  expect(photo.height).toBe(1536)
})

it('surfaces an unreadable image as a clear error rather than silently using 0 dimensions', async () => {
  mockGetSize.mockImplementation((_uri: string, _success: unknown, failure: (err: Error) => void) =>
    failure(new Error('decode failed')),
  )

  const { result } = renderHook(() => useChatPhotoUpload())

  await act(async () => {
    await expect(
      result.current.prepareFromAsset({ uri: 'file:///corrupt.jpg', width: 0, height: 0 }),
    ).rejects.toThrow(/could not read/i)
  })
  expect(prepareImageVariants).not.toHaveBeenCalled()
})

it('requests photo library permission before launching the picker', async () => {
  // expo-image-picker never prompts on its own for the gallery on Android, and
  // on iOS the PHPicker is privacy-respecting but the OS still records
  // canAskAgain state we want surfaced as a settings hint when the user has
  // muted the prompt permanently. Mirror captureFromCamera's preflight.
  const callOrder: string[] = []
  ;(ImagePicker.requestMediaLibraryPermissionsAsync as jest.Mock).mockImplementation(async () => {
    callOrder.push('permission')
    return { granted: true, canAskAgain: true }
  })
  ;(ImagePicker.launchImageLibraryAsync as jest.Mock).mockImplementation(async () => {
    callOrder.push('launch')
    return { canceled: true, assets: [] }
  })

  const { result } = renderHook(() => useChatPhotoUpload())

  await act(async () => {
    await result.current.pickFromLibrary()
  })

  expect(callOrder).toEqual(['permission', 'launch'])
  expect(ImagePicker.requestMediaLibraryPermissionsAsync).toHaveBeenCalled()
  expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalled()
})

it('surfaces a denied photo library permission as an error without launching the picker', async () => {
  ;(ImagePicker.requestMediaLibraryPermissionsAsync as jest.Mock).mockResolvedValue({
    granted: false,
    canAskAgain: true,
  })
  const { result } = renderHook(() => useChatPhotoUpload())

  let photo: unknown
  await act(async () => {
    photo = await result.current.pickFromLibrary()
  })

  expect(photo).toBeNull()
  expect(result.current.error).toBe('Photo library access denied')
  expect(ImagePicker.launchImageLibraryAsync).not.toHaveBeenCalled()
})

it('points to device settings when the photo library is permanently denied', async () => {
  ;(ImagePicker.requestMediaLibraryPermissionsAsync as jest.Mock).mockResolvedValue({
    granted: false,
    canAskAgain: false,
  })
  const { result } = renderHook(() => useChatPhotoUpload())

  let photo: unknown
  await act(async () => {
    photo = await result.current.pickFromLibrary()
  })

  expect(photo).toBeNull()
  expect(result.current.error).toMatch(/device settings/)
  expect(ImagePicker.launchImageLibraryAsync).not.toHaveBeenCalled()
})

it('returns null when the photo library picker is cancelled', async () => {
  ;(ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({
    canceled: true,
    assets: [],
  })
  const { result } = renderHook(() => useChatPhotoUpload())

  let photo: unknown
  await act(async () => {
    photo = await result.current.pickFromLibrary()
  })

  expect(photo).toBeNull()
  expect(result.current.error).toBeNull()
})
