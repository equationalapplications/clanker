import { renderHook, act } from '@testing-library/react-native'
import { setActiveCharacterId, useActiveCharacterId } from '~/hooks/useActiveCharacterId'

describe('useActiveCharacterId', () => {
  afterEach(() => {
    setActiveCharacterId(null)
  })

  it('updates subscribers when the active character changes', () => {
    const { result } = renderHook(() => useActiveCharacterId())

    expect(result.current).toBeNull()

    act(() => {
      setActiveCharacterId('char-b')
    })

    expect(result.current).toBe('char-b')
  })
})
