import React from 'react'
import { act, create } from 'react-test-renderer'
import { useAvatarUpload } from '~/hooks/useAvatarUpload'
import { saveCharacterImageLocally } from '~/services/localImageStorageService'
import * as ImagePicker from 'expo-image-picker'
import * as FileSystem from 'expo-file-system/legacy'
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator'

jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(),
}))

jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn(),
  SaveFormat: {
    WEBP: 'WEBP',
  },
}))

jest.mock('expo-file-system/legacy', () => ({
  readAsStringAsync: jest.fn(),
  EncodingType: {
    Base64: 'base64',
  },
}))

jest.mock('~/services/localImageStorageService', () => ({
  saveCharacterImageLocally: jest.fn(),
}))

const mockLaunchImageLibraryAsync = jest.mocked(ImagePicker.launchImageLibraryAsync)
const mockManipulateAsync = jest.mocked(manipulateAsync)
const mockReadAsStringAsync = jest.mocked(FileSystem.readAsStringAsync)
const mockSaveCharacterImageLocally = jest.mocked(saveCharacterImageLocally)

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

function renderHook(onImageUploaded?: (dataUri: string) => void) {
  let hookValue: ReturnType<typeof useAvatarUpload> | null = null

  function Probe() {
    hookValue = useAvatarUpload({
      characterId: 'char-1',
      onImageUploaded,
    })
    return null
  }

  act(() => {
    create(<Probe />)
  })

  return {
    getHookValue: () => {
      if (!hookValue) {
        throw new Error('hook value missing')
      }
      return hookValue
    },
  }
}

describe('useAvatarUpload', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns null and skips save when picker is canceled', async () => {
    mockLaunchImageLibraryAsync.mockResolvedValue({ canceled: true, assets: null } as never)

    const { getHookValue } = renderHook()

    let result: string | null = null
    await act(async () => {
      result = await getHookValue().uploadAvatar()
    })

    expect(result).toBeNull()
    expect(mockSaveCharacterImageLocally).not.toHaveBeenCalled()
    expect(getHookValue().error).toBeNull()
  })

  it('resizes large images, converts to webp, saves, and calls callback', async () => {
    const onImageUploaded = jest.fn()
    mockLaunchImageLibraryAsync.mockResolvedValue(makePickerResult(1800, 1200) as never)
    mockManipulateAsync.mockResolvedValue({ uri: 'file://converted.webp' } as never)
    mockReadAsStringAsync.mockResolvedValue('BASE64_DATA' as never)
    mockSaveCharacterImageLocally.mockResolvedValue('data:image/webp;base64,BASE64_DATA')

    const { getHookValue } = renderHook(onImageUploaded)

    let result: string | null = null
    await act(async () => {
      result = await getHookValue().uploadAvatar()
    })

    expect(mockManipulateAsync).toHaveBeenCalledWith(
      'file://source.jpg',
      [{ resize: { width: 1024 } }],
      { format: SaveFormat.WEBP, compress: 0.9 },
    )
    expect(mockSaveCharacterImageLocally).toHaveBeenCalledWith('char-1', 'BASE64_DATA', 'image/webp')
    expect(onImageUploaded).toHaveBeenCalledWith('data:image/webp;base64,BASE64_DATA')
    expect(result).toBe('data:image/webp;base64,BASE64_DATA')
    expect(getHookValue().isUploading).toBe(false)
  })

  it('keeps valid small images unresized', async () => {
    mockLaunchImageLibraryAsync.mockResolvedValue(makePickerResult(300, 300) as never)
    mockManipulateAsync.mockResolvedValue({ uri: 'file://converted.webp' } as never)
    mockReadAsStringAsync.mockResolvedValue('BASE64_DATA' as never)
    mockSaveCharacterImageLocally.mockResolvedValue('data:image/webp;base64,BASE64_DATA')

    const { getHookValue } = renderHook()

    await act(async () => {
      await getHookValue().uploadAvatar()
    })

    expect(mockManipulateAsync).toHaveBeenCalledWith(
      'file://source.jpg',
      [],
      { format: SaveFormat.WEBP, compress: 0.9 },
    )
  })

  it('sets error and returns null when manipulateAsync fails', async () => {
    mockLaunchImageLibraryAsync.mockResolvedValue(makePickerResult(600, 600) as never)
    mockManipulateAsync.mockRejectedValue(new Error('Failed to convert image'))

    const { getHookValue } = renderHook()

    let result: string | null = 'init'
    await act(async () => {
      result = await getHookValue().uploadAvatar()
    })

    expect(result).toBeNull()
    expect(getHookValue().error).toBe('Failed to convert image')
    expect(mockSaveCharacterImageLocally).not.toHaveBeenCalled()
  })

  it('sets error and returns null when local save fails', async () => {
    mockLaunchImageLibraryAsync.mockResolvedValue(makePickerResult(600, 600) as never)
    mockManipulateAsync.mockResolvedValue({ uri: 'file://converted.webp' } as never)
    mockReadAsStringAsync.mockResolvedValue('BASE64_DATA' as never)
    mockSaveCharacterImageLocally.mockRejectedValue(new Error('SQLite write failed'))

    const { getHookValue } = renderHook()

    let result: string | null = 'init'
    await act(async () => {
      result = await getHookValue().uploadAvatar()
    })

    expect(result).toBeNull()
    expect(getHookValue().error).toBe('SQLite write failed')
  })

  it('normalizes permission errors from picker', async () => {
    mockLaunchImageLibraryAsync.mockRejectedValue(new Error('Permission denied by user'))

    const { getHookValue } = renderHook()

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
    mockManipulateAsync.mockResolvedValue({ uri: 'file://converted.webp' } as never)
    mockReadAsStringAsync.mockResolvedValue('BASE64_DATA' as never)
    mockSaveCharacterImageLocally.mockResolvedValue('data:image/webp;base64,BASE64_DATA')

    const { getHookValue } = renderHook()

    let pendingUpload!: Promise<string | null>
    act(() => {
      pendingUpload = getHookValue().uploadAvatar()
    })

    expect(getHookValue().isUploading).toBe(true)

    await act(async () => {
      pickerDeferred.resolve(makePickerResult(400, 400))
      await pendingUpload
    })

    expect(getHookValue().isUploading).toBe(false)
  })

  it('rejects images smaller than 200x200 and skips save', async () => {
    mockLaunchImageLibraryAsync.mockResolvedValue(makePickerResult(180, 199) as never)

    const { getHookValue } = renderHook()

    let result: string | null = 'init'
    await act(async () => {
      result = await getHookValue().uploadAvatar()
    })

    expect(result).toBeNull()
    expect(getHookValue().error).toBe('Image too small. Minimum size is 200×200 pixels.')
    expect(mockSaveCharacterImageLocally).not.toHaveBeenCalled()
  })
})
