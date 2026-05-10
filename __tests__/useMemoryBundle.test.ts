jest.mock('@equationalapplications/expo-llm-wiki', () => ({
  ...jest.requireActual('@equationalapplications/expo-llm-wiki'),
  useWiki: jest.fn(),
}))

import { renderHook, waitFor, act } from '@testing-library/react-native'
import { useWiki } from '@equationalapplications/expo-llm-wiki'
import { useMemoryBundle } from '~/hooks/useMemoryBundle'

const BUNDLE = {
  facts: [{ id: 'f1', entity_id: 'char1', title: 'Likes cats', body: 'User said they like cats', tags: [], confidence: 'certain' as const, source_type: 'user_stated' as const, source_hash: null, source_ref: null, created_at: 1, updated_at: 1, last_accessed_at: null, access_count: 0, deleted_at: null }],
  tasks: [],
  events: [{ id: 'e1', entity_id: 'char1', event_type: 'observation' as const, summary: 'Mentioned cats', created_at: 1 }],
}

describe('useMemoryBundle', () => {
  test('fetches memory bundle on mount', async () => {
    const getMemoryBundle = jest.fn().mockResolvedValue(BUNDLE)
    jest.mocked(useWiki).mockReturnValue({ getMemoryBundle } as never)

    const { result } = renderHook(() => useMemoryBundle('char1'))

    expect(result.current.isLoading).toBe(true)
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(getMemoryBundle).toHaveBeenCalledWith('char1')
    expect(result.current.bundle).toEqual(BUNDLE)
    expect(result.current.error).toBeNull()
  })

  test('returns null bundle when wiki is unavailable', async () => {
    jest.mocked(useWiki).mockReturnValue(null as never)

    const { result } = renderHook(() => useMemoryBundle('char1'))

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.bundle).toBeNull()
  })

  test('refetch reloads data', async () => {
    const getMemoryBundle = jest.fn().mockResolvedValue(BUNDLE)
    jest.mocked(useWiki).mockReturnValue({ getMemoryBundle } as never)

    const { result } = renderHook(() => useMemoryBundle('char1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => { await result.current.refetch() })

    expect(getMemoryBundle).toHaveBeenCalledTimes(2)
  })
})
