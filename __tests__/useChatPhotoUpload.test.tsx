import { renderHook, act } from '@testing-library/react-native'
import * as ImagePicker from 'expo-image-picker'
import { useChatPhotoUpload } from '~/hooks/useChatPhotoUpload'
import { prepareImageVariants } from '~/services/imageVariants'

jest.mock('expo-image-picker')
jest.mock('~/services/imageVariants')

const VARIANTS = {
  master: { base64: 'MASTER', mimeType: 'image/webp' as const },
  thumb: { base64: 'THUMB', mimeType: 'image/webp' as const },
}

beforeEach(() => {
  jest.resetAllMocks()
  ;(prepareImageVariants as jest.Mock).mockResolvedValue(VARIANTS)
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

it('surfaces a denied camera permission as an error rather than throwing', async () => {
  ;(ImagePicker.launchCameraAsync as jest.Mock).mockRejectedValue(new Error('denied'))
  const { result } = renderHook(() => useChatPhotoUpload())

  let photo: unknown
  await act(async () => {
    photo = await result.current.captureFromCamera()
  })

  expect(photo).toBeNull()
  expect(result.current.error).toBe('Camera access denied')
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