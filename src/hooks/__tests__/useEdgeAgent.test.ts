import { renderHook, act } from '@testing-library/react-native'
import { useEdgeAgent } from '../useEdgeAgent'

describe('useEdgeAgent', () => {
  it('always escalates (no on-device triage)', async () => {
    const { result } = renderHook(() => useEdgeAgent())

    let response: { escalated: boolean; text?: string } | undefined
    await act(async () => {
      response = await result.current.sendMessage('Hi there')
    })

    expect(response).toEqual({ escalated: true })
    expect(result.current.escalationState).toBe('escalating')
    expect(result.current.isThinking).toBe(false)
  })
})
