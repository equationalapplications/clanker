import { renderHook, waitFor } from '@testing-library/react-native'
import { useResolvedImage } from '~/hooks/useResolvedImage'

const mockGetById = jest.fn()
const mockResolve = jest.fn()

jest.mock('~/database/characterImageDatabase', () => ({
  getCharacterImageById: (...a: unknown[]) => mockGetById(...a),
}))
jest.mock('~/services/localImageStore', () => ({
  resolveImageUri: (...a: unknown[]) => mockResolve(...a),
}))

beforeEach(() => {
  jest.clearAllMocks()
  mockGetById.mockResolvedValue({
    id: 'img-1',
    storage_kind: 'inline',
    master_ref: 'M',
    mime_type: 'image/webp',
  })
  mockResolve.mockResolvedValue('data:image/webp;base64,M')
})

describe('useResolvedImage', () => {
  it('returns null while nothing is requested', async () => {
    const { result } = renderHook(() => useResolvedImage(null, 'master'))
    await waitFor(() => {
      expect(result.current.uri).toBeNull()
      expect(result.current.isResolved).toBe(false)
    })
    expect(mockGetById).not.toHaveBeenCalled()
  })

  it('resolves the row for the requested variant', async () => {
    const { result } = renderHook(() => useResolvedImage('img-1', 'thumb'))
    await waitFor(() => {
      expect(result.current.uri).toBe('data:image/webp;base64,M')
    })
    expect(mockResolve).toHaveBeenCalledWith(expect.objectContaining({ id: 'img-1' }), 'thumb')
  })

  it('yields null when the row is gone, and isResolved=true once the lookup completes', async () => {
    mockGetById.mockResolvedValue(null)
    const { result } = renderHook(() => useResolvedImage('missing', 'master'))
    await waitFor(() => {
      expect(result.current.uri).toBeNull()
      expect(result.current.isResolved).toBe(true)
    })
  })

  it('yields null instead of throwing when resolution fails', async () => {
    mockResolve.mockRejectedValue(new Error('offline'))
    const { result } = renderHook(() => useResolvedImage('img-1', 'master'))
    await waitFor(() => {
      expect(result.current.uri).toBeNull()
      expect(result.current.isResolved).toBe(true)
    })
  })
})
