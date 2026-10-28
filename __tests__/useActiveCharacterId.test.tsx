import { renderHook, act, waitFor } from '@testing-library/react-native'
import { setActiveCharacterId, useActiveCharacterId } from '~/hooks/useActiveCharacterId'

describe('useActiveCharacterId', () => {
  afterEach(async () => {
    setActiveCharacterId(null)
  })

  it('updates subscribers when the active character changes', async () => {
    const { result } = await renderHook(() => useActiveCharacterId())

    expect(result.current).toBeNull()

    act(() => {
      setActiveCharacterId('char-b')
    })

    // React 19 flushes useSyncExternalStore re-subscription asynchronously.
    await waitFor(() => expect(result.current).toBe('char-b'))
  })
})
