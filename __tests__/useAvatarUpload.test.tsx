import { renderHook as rtlRenderHook, act } from '@testing-library/react-native'
import { useAvatarUpload } from '~/hooks/useAvatarUpload'
import { saveCharacterImage } from '~/services/characterImageService'
import * as ImagePicker from 'expo-image-picker'
import { manipulateAsync } from 'expo-image-manipulator'

jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(),
}))

jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn(),
}))

jest.mock('~/services/characterImageService', () => ({
  saveCharacterImage: jest.fn(),
}))

jest.mock('~/config/firebaseConfig', () => ({
  getCurrentUser: jest.fn(() => ({ uid: 'user-1' })),
  appCheckReady: Promise.resolve(),
}))

jest.mock('~/utilities/webpSupport', () => ({
  getEncodeTarget: () => ({ format: 'webp', mimeType: 'image/webp' }),
}))

const mockCharacterSend = jest.fn()
jest.mock('~/hooks/useMachines', () => ({
  useCharacterMachine: () => ({ send: mockCharacterSend }),
}))

const mockLaunchImageLibraryAsync = jest.mocked(ImagePicker.launchImageLibraryAsync)
const mockManipulateAsync = jest.mocked(manipulateAsync)
const mockSaveCharacterImage = jest.mocked(saveCharacterImage)

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

function makePickerResult(width: number, height: number, uri = 'file://source.jpg') {
  return {
    canceled: false as const,
    assets: [{ uri, width, height }],
  }
}

function renderHook(onImageUploaded?: (imageId: string) => void) {
  // RNTL 14's renderHook replaces the hand-rolled react-test-renderer Probe:
  // its act no longer flushes async state updates under React 19.
  return rtlRenderHook(() =>
    useAvatarUpload({
      characterId: 'char-1',
      onImageUploaded,
    }),
  ).then((rendered) => ({
    getHookValue: () => rendered.result.current,
  }))
}

describe('useAvatarUpload', () => {
  beforeEach(async () => {
    jest.clearAllMocks()
    mockCharacterSend.mockReset()
    // mockReset (unlike clearAllMocks) drops leaked implementations from the
    // previous test — e.g. a never-resolving mockReturnValue on the picker.
    mockLaunchImageLibraryAsync.mockReset()
    mockManipulateAsync.mockReset()
    mockSaveCharacterImage.mockReset()
  })

  it('returns null and skips save when picker is canceled', async () => {
    mockLaunchImageLibraryAsync.mockResolvedValue({ canceled: true, assets: null } as never)

    const { getHookValue } = await renderHook()

    let result: string | null = null
    await act(async () => {
      result = await getHookValue().uploadAvatar()
    })

    expect(result).toBeNull()
    expect(mockSaveCharacterImage).not.toHaveBeenCalled()
    expect(getHookValue().error).toBeNull()
  })

  it('requests a square crop from the picker', async () => {
    mockLaunchImageLibraryAsync.mockResolvedValue(makePickerResult(2000, 1000) as never)
    mockSaveCharacterImage.mockResolvedValue({ id: 'img-1' } as never)

    const { getHookValue } = await renderHook()

    await act(async () => {
      await getHookValue().uploadAvatar()
    })

    expect(mockLaunchImageLibraryAsync).toHaveBeenCalledWith(
      expect.objectContaining({ allowsEditing: true, aspect: [1, 1] }),
    )
  })

  it('routes the upload into the gallery as source "uploaded"', async () => {
    mockLaunchImageLibraryAsync.mockResolvedValue(makePickerResult(1024, 1024) as never)
    mockSaveCharacterImage.mockResolvedValue({ id: 'img-1' } as never)

    const { getHookValue } = await renderHook()

    await act(async () => {
      await getHookValue().uploadAvatar()
    })

    expect(mockSaveCharacterImage).toHaveBeenCalledWith({
      characterId: 'char-1',
      userId: 'user-1',
      uri: 'file://source.jpg',
      width: 1024,
      height: 1024,
      source: 'uploaded',
    })
  })

  it('returns the new image id so the caller can activate it', async () => {
    mockLaunchImageLibraryAsync.mockResolvedValue(makePickerResult(1024, 1024) as never)
    mockSaveCharacterImage.mockResolvedValue({ id: 'img-42' } as never)

    const { getHookValue } = await renderHook()

    let result: string | null = null
    await act(async () => {
      result = await getHookValue().uploadAvatar()
    })

    expect(result).toBe('img-42')
  })

  it('still rejects images below the 200px minimum', async () => {
    mockLaunchImageLibraryAsync.mockResolvedValue(makePickerResult(150, 150) as never)

    const { getHookValue } = await renderHook()

    let result: string | null = 'init'
    await act(async () => {
      result = await getHookValue().uploadAvatar()
    })

    expect(result).toBeNull()
    expect(getHookValue().error).toBe('Image too small. Minimum size is 200×200 pixels.')
    expect(mockSaveCharacterImage).not.toHaveBeenCalled()
  })

  it('normalizes permission errors from picker', async () => {
    mockLaunchImageLibraryAsync.mockRejectedValue(new Error('Permission denied by user'))

    const { getHookValue } = await renderHook()

    let result: string | null = 'init'
    await act(async () => {
      result = await getHookValue().uploadAvatar()
    })

    expect(result).toBeNull()
    expect(getHookValue().error).toBe('Photo library access denied')
  })

  it('toggles isUploading true during request and false after completion', async () => {
    const pickerDeferred = createDeferred<ReturnType<typeof makePickerResult>>()
    mockLaunchImageLibraryAsync.mockReturnValue(pickerDeferred.promise as never)
    mockSaveCharacterImage.mockResolvedValue({ id: 'img-1' } as never)

    const { getHookValue } = await renderHook()

    let pendingUpload!: Promise<string | null>
    await act(async () => {
      pendingUpload = getHookValue().uploadAvatar()
    })

    expect(getHookValue().isUploading).toBe(true)

    await act(async () => {
      pickerDeferred.resolve(makePickerResult(400, 400))
      await pendingUpload
    })

    expect(getHookValue().isUploading).toBe(false)
  })

  it('sets error and returns null when save fails', async () => {
    mockLaunchImageLibraryAsync.mockResolvedValue(makePickerResult(600, 600) as never)
    mockSaveCharacterImage.mockRejectedValue(new Error('SQLite write failed'))

    const { getHookValue } = await renderHook()

    let result: string | null = 'init'
    await act(async () => {
      result = await getHookValue().uploadAvatar()
    })

    expect(result).toBeNull()
    expect(getHookValue().error).toBe('SQLite write failed')
  })
})
