import React from 'react'
import { act, create } from 'react-test-renderer'
import { Alert, AppState } from 'react-native'

const mockRouterPush = jest.fn()
const mockUseCharacter = jest.fn()
const mockUseSelector = jest.fn()
const mockUseCurrentPlan = jest.fn()
const mockStartRecording = jest.fn()
const mockStopRecording = jest.fn()
const mockPlayChunk = jest.fn()
const mockClearPlaybackQueue = jest.fn()
const mockOnAudioChunk = jest.fn().mockReturnValue(() => {})
const mockSend = jest.fn()
const mockAuthSend = jest.fn()
const mockUseMachine = jest.fn()
const mockAddEventListener = jest.fn()

jest.mock('~/machines/liveVoiceMachine', () => {
  const machine = {
    id: 'liveVoiceMachine',
    provide: jest.fn(),
  }
  machine.provide.mockReturnValue(machine)
  return { liveVoiceMachine: machine }
})
jest.mock('expo-router', () => ({ router: { push: (...a: unknown[]) => mockRouterPush(...a) } }))
jest.mock('expo-router/react-navigation', () => ({
  useNavigation: () => ({ addListener: jest.fn().mockReturnValue(jest.fn()) }),
}))
jest.mock('~/hooks/useCharacters', () => ({ useCharacter: (...a: unknown[]) => mockUseCharacter(...a) }))
jest.mock('~/hooks/useMachines', () => ({ useAuthMachine: () => ({ send: mockAuthSend }) }))
jest.mock('~/hooks/useCurrentPlan', () => ({ useCurrentPlan: (...a: unknown[]) => mockUseCurrentPlan(...a) }))
jest.mock('@xstate/react', () => ({
  useSelector: (...a: unknown[]) => mockUseSelector(...a),
  useMachine: (...a: unknown[]) => mockUseMachine(...a),
}))
jest.mock('~/hooks/useLiveAudioIO', () => ({
  useLiveAudioIO: () => ({
    recordingState: 'idle',
    playbackState: 'idle',
    error: null,
    startRecording: mockStartRecording,
    stopRecording: mockStopRecording,
    playChunk: mockPlayChunk,
    clearPlaybackQueue: mockClearPlaybackQueue,
    onAudioChunk: mockOnAudioChunk,
  }),
}))
jest.mock('react-native', () => ({
  Alert: { alert: jest.fn() },
  AppState: { addEventListener: (...a: unknown[]) => mockAddEventListener(...a) },
  Platform: { OS: 'ios' },
}))

import { useLiveVoiceChat } from '~/hooks/useLiveVoiceChat'
import { liveVoiceMachine } from '~/machines/liveVoiceMachine'

function makeIdleSnapshot() {
  return {
    matches: (pattern: unknown) => {
      if (typeof pattern === 'string') return pattern === 'idle'
      return false
    },
    context: { transcript: [], activeTool: null, remainingCredits: 10, socketError: null },
  }
}

function TestHarness({ onMount }: { onMount: (h: ReturnType<typeof useLiveVoiceChat>) => void }) {
  const hook = useLiveVoiceChat('char1')
  React.useEffect(() => {
    onMount(hook)
  }, [])
  return null
}

describe('useLiveVoiceChat', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.mocked(liveVoiceMachine.provide).mockReturnValue(liveVoiceMachine as never)
    const snapshot = makeIdleSnapshot()
    mockUseMachine.mockReturnValue([snapshot, mockSend, { subscribe: jest.fn(), getSnapshot: () => snapshot }])
    mockUseSelector.mockReturnValue({ uid: 'user1' })
    mockAddEventListener.mockReturnValue({ remove: jest.fn() })
  })

  test('startCall shows alert if character has no voice', async () => {
    mockUseCharacter.mockReturnValue({ data: { id: 'char1', voice: null, save_to_cloud: 1 } })
    mockUseCurrentPlan.mockReturnValue({ remainingCredits: 10 })

    let hookRef: ReturnType<typeof useLiveVoiceChat> | null = null
    await act(async () => {
      create(<TestHarness onMount={(h) => { hookRef = h }} />)
    })

    await act(async () => {
      await hookRef!.startCall()
    })

    expect(Alert.alert).toHaveBeenCalledWith(
      'No Voice Set',
      expect.any(String),
      expect.any(Array),
    )
    expect(mockSend).not.toHaveBeenCalled()
  })

  test('startCall shows alert if insufficient credits', async () => {
    mockUseCharacter.mockReturnValue({ data: { id: 'char1', voice: 'en-US', save_to_cloud: 1 } })
    mockUseCurrentPlan.mockReturnValue({ remainingCredits: 1 })

    let hookRef: ReturnType<typeof useLiveVoiceChat> | null = null
    await act(async () => {
      create(<TestHarness onMount={(h) => { hookRef = h }} />)
    })

    await act(async () => {
      await hookRef!.startCall()
    })

    expect(Alert.alert).toHaveBeenCalledWith(
      'Insufficient Credits',
      expect.any(String),
      expect.any(Array),
    )
  })

  test('startCall shows alert if save_to_cloud is disabled', async () => {
    mockUseCharacter.mockReturnValue({ data: { id: 'char1', voice: 'en-US', save_to_cloud: 0 } })
    mockUseCurrentPlan.mockReturnValue({ remainingCredits: 10 })

    let hookRef: ReturnType<typeof useLiveVoiceChat> | null = null
    await act(async () => {
      create(<TestHarness onMount={(h) => { hookRef = h }} />)
    })

    await act(async () => {
      await hookRef!.startCall()
    })

    expect(Alert.alert).toHaveBeenCalledWith(
      'Cloud Sync Required',
      expect.any(String),
      expect.any(Array),
    )
  })

  test('startCall sends START_CALL to machine when all checks pass', async () => {
    mockUseCharacter.mockReturnValue({ data: { id: 'char1', voice: 'en-US', save_to_cloud: 1 } })
    mockUseCurrentPlan.mockReturnValue({ remainingCredits: 10 })
    mockStartRecording.mockResolvedValue(true)

    let hookRef: ReturnType<typeof useLiveVoiceChat> | null = null
    await act(async () => {
      create(<TestHarness onMount={(h) => { hookRef = h }} />)
    })

    await act(async () => {
      await hookRef!.startCall()
    })

    expect(mockStartRecording).toHaveBeenCalled()
    expect(mockSend).toHaveBeenCalledWith({ type: 'START_CALL' })
  })

  test('AppState background → sends END_CALL to machine when live', async () => {
    mockUseCharacter.mockReturnValue({ data: { id: 'char1', voice: 'en-US', save_to_cloud: 1 } })
    mockUseCurrentPlan.mockReturnValue({ remainingCredits: 10 })

    const liveSnapshot = {
      matches: (pattern: unknown) => {
        if (typeof pattern === 'object' && pattern !== null) {
          const p = pattern as Record<string, string>
          return p['session'] === 'live'
        }
        return false
      },
      context: { transcript: [], activeTool: null, remainingCredits: 10, socketError: null },
    }
    mockUseMachine.mockReturnValue([liveSnapshot, mockSend, { subscribe: jest.fn(), getSnapshot: () => liveSnapshot }])

    let appStateListener: ((state: string) => void) | null = null
    mockAddEventListener.mockImplementation((_event: string, cb: (state: string) => void) => {
      appStateListener = cb
      return { remove: jest.fn() }
    })

    await act(async () => {
      create(<TestHarness onMount={() => {}} />)
    })

    act(() => {
      appStateListener?.('background')
    })

    expect(mockStopRecording).toHaveBeenCalled()
    expect(mockSend).toHaveBeenCalledWith({ type: 'END_CALL' })
  })

  test('derived state: isLive true when machine in session.live', async () => {
    mockUseCharacter.mockReturnValue({ data: { id: 'char1', voice: 'en-US', save_to_cloud: 1 } })
    mockUseCurrentPlan.mockReturnValue({ remainingCredits: 10 })

    const liveSnapshot = {
      matches: (pattern: unknown) => {
        if (typeof pattern === 'object' && pattern !== null) {
          const p = pattern as Record<string, string>
          return p['session'] === 'live'
        }
        return false
      },
      context: {
        transcript: [{ _id: '1', text: 'Hi', createdAt: new Date(), user: { _id: 'char1' } }],
        activeTool: 'wiki_read',
        remainingCredits: 8,
        socketError: null,
      },
    }
    mockUseMachine.mockReturnValue([liveSnapshot, mockSend, { subscribe: jest.fn(), getSnapshot: () => liveSnapshot }])

    let hookRef: ReturnType<typeof useLiveVoiceChat> | null = null
    await act(async () => {
      create(<TestHarness onMount={(h) => { hookRef = h }} />)
    })

    expect(hookRef!.isLive).toBe(true)
    expect(hookRef!.activeTool).toBe('wiki_read')
    expect(hookRef!.remainingCredits).toBe(8)
    expect(hookRef!.transcript).toHaveLength(1)
  })

  test('does not dispatch USAGE_SNAPSHOT_RECEIVED on initial seed', async () => {
    mockUseCharacter.mockReturnValue({ data: { id: 'char1', voice: 'en-US', save_to_cloud: 1 } })
    mockUseCurrentPlan.mockReturnValue({ remainingCredits: 10 })

    await act(async () => {
      create(<TestHarness onMount={() => {}} />)
    })

    expect(mockAuthSend).not.toHaveBeenCalled()
  })

  test('dispatches USAGE_SNAPSHOT_RECEIVED when live remainingCredits changes', async () => {
    mockUseCharacter.mockReturnValue({ data: { id: 'char1', voice: 'en-US', save_to_cloud: 1 } })
    mockUseCurrentPlan.mockReturnValue({ remainingCredits: 10 })

    let root: ReturnType<typeof create>
    await act(async () => {
      root = create(<TestHarness onMount={() => {}} />)
    })

    // Simulate a per-minute socket tick: machine now reports 9 credits.
    const tickSnapshot = {
      matches: (pattern: unknown) => {
        if (typeof pattern === 'object' && pattern !== null) {
          return (pattern as Record<string, string>)['session'] === 'live'
        }
        return false
      },
      context: { transcript: [], activeTool: null, remainingCredits: 9, socketError: null },
    }
    mockUseMachine.mockReturnValue([tickSnapshot, mockSend, { subscribe: jest.fn(), getSnapshot: () => tickSnapshot }])

    await act(async () => {
      root!.update(<TestHarness onMount={() => {}} />)
    })

    expect(mockAuthSend).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'USAGE_SNAPSHOT_RECEIVED',
        source: 'liveVoice',
        remainingCredits: 9,
        planTier: null,
        verifiedAt: expect.any(String),
      }),
    )
  })

  test('does not re-dispatch when remainingCredits is unchanged across renders', async () => {
    mockUseCharacter.mockReturnValue({ data: { id: 'char1', voice: 'en-US', save_to_cloud: 1 } })
    mockUseCurrentPlan.mockReturnValue({ remainingCredits: 10 })

    let root: ReturnType<typeof create>
    await act(async () => {
      root = create(<TestHarness onMount={() => {}} />)
    })

    await act(async () => {
      root!.update(<TestHarness onMount={() => {}} />)
    })

    expect(mockAuthSend).not.toHaveBeenCalled()
  })
})
