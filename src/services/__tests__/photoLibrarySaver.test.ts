import { saveToPhotos } from '../photoLibrarySaver'
import * as MediaLibrary from 'expo-media-library'

jest.mock('expo-media-library', () => ({
  requestPermissionsAsync: jest.fn(),
  saveToLibraryAsync: jest.fn(),
}))

describe('saveToPhotos (native)', () => {
  beforeEach(() => jest.clearAllMocks())

  it('requests add-only permission and reports saved once the URI lands in the library', async () => {
    ;(MediaLibrary.requestPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true })
    ;(MediaLibrary.saveToLibraryAsync as jest.Mock).mockResolvedValue(undefined)

    await expect(saveToPhotos('file:///cache/master.webp')).resolves.toBe('saved')

    expect(MediaLibrary.requestPermissionsAsync).toHaveBeenCalledWith(true)
    expect(MediaLibrary.saveToLibraryAsync).toHaveBeenCalledWith('file:///cache/master.webp')
  })

  it('reports denied on refusal and never touches the library', async () => {
    ;(MediaLibrary.requestPermissionsAsync as jest.Mock).mockResolvedValue({ granted: false })

    await expect(saveToPhotos('file:///cache/master.webp')).resolves.toBe('denied')

    expect(MediaLibrary.saveToLibraryAsync).not.toHaveBeenCalled()
  })

  it('maps any bridge failure to failed instead of rejecting', async () => {
    ;(MediaLibrary.requestPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true })
    ;(MediaLibrary.saveToLibraryAsync as jest.Mock).mockRejectedValue(new Error('no space'))

    await expect(saveToPhotos('file:///cache/master.webp')).resolves.toBe('failed')
  })

  it('maps a permission-prompt crash to failed instead of rejecting', async () => {
    ;(MediaLibrary.requestPermissionsAsync as jest.Mock).mockRejectedValue(
      new Error('bridge unavailable'),
    )

    await expect(saveToPhotos('file:///cache/master.webp')).resolves.toBe('failed')
  })
})
