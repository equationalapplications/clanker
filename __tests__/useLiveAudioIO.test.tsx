import React from 'react'
import { act, create } from 'react-test-renderer'

const mockRequestRecordingPermissionsAsync = jest.fn()
const mockSetAudioModeAsync = jest.fn()
const mockCreateAudioPlayer = jest.fn()
const mockRecorderStart = jest.fn()
const mockRecorderStop = jest.fn()
const mockPlayerPlay = jest.fn()
const mockPlayerRelease = jest.fn()
const mockPlayerAddListener = jest.fn()

let mockOnDataCallback: ((data: string) => void) | null = null

jest.mock('expo-audio', () => ({
  requestRecordingPermissionsAsync: (...a: unknown[]) => mockRequestRecordingPermissionsAsync(...a),
  setAudioModeAsync: (...a: unknown[]) => mockSetAudioModeAsync(...a),
  createAudioPlayer: (...a: unknown[]) => mockCreateAudioPlayer(...a),
}))

jest.mock('react-native-live-audio-stream', () => ({
  __esModule: true,
  default: {
    init: jest.fn(),
    start: (...a: unknown[]) => mockRecorderStart(...a),
    stop: (...a: unknown[]) => mockRecorderStop(...a),
    on: (_event: string, cb: (data: string) => void) => {
      mockOnDataCallback = cb
    },
  },
}))

import LiveAudioStream from 'react-native-live-audio-stream'
import { useLiveAudioIO } from '~/hooks/useLiveAudioIO'

let hookRef: ReturnType<typeof useLiveAudioIO>

function TestHarness() {
  hookRef = useLiveAudioIO()
  return null
}

describe('useLiveAudioIO', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockOnDataCallback = null
    mockSetAudioModeAsync.mockResolvedValue(undefined)
    mockRequestRecordingPermissionsAsync.mockResolvedValue({ granted: true })
    mockRecorderStart.mockReturnValue(undefined)
    mockRecorderStop.mockReturnValue(undefined)
    mockCreateAudioPlayer.mockReturnValue({
      play: mockPlayerPlay,
      release: mockPlayerRelease,
      addListener: mockPlayerAddListener.mockReturnValue({ remove: jest.fn() }),
    })
  })

  test('startRecording requests permissions and starts recorder', async () => {
    await act(async () => {
      create(<TestHarness />)
    })

    await act(async () => {
      await hookRef.startRecording()
    })

    expect(mockRequestRecordingPermissionsAsync).toHaveBeenCalled()
    expect(mockRecorderStart).toHaveBeenCalled()
    expect(LiveAudioStream.init).toHaveBeenCalled()
    expect(hookRef.recordingState).toBe('recording')
  })

  test('startRecording with denied permission sets error state', async () => {
    mockRequestRecordingPermissionsAsync.mockResolvedValue({ granted: false })

    await act(async () => {
      create(<TestHarness />)
    })

    await act(async () => {
      await hookRef.startRecording()
    })

    expect(hookRef.recordingState).toBe('error')
    expect(hookRef.error).toMatch(/permission/i)
  })

  test('onAudioChunk fires when recorder emits data', async () => {
    await act(async () => {
      create(<TestHarness />)
    })

    const received: string[] = []
    hookRef.onAudioChunk((chunk) => received.push(chunk))

    await act(async () => {
      await hookRef.startRecording()
    })

    act(() => {
      mockOnDataCallback?.('base64audiodata')
    })

    expect(received).toEqual(['base64audiodata'])
  })

  test('clearPlaybackQueue stops player immediately', async () => {
    await act(async () => {
      create(<TestHarness />)
    })

    await act(async () => {
      await hookRef.playChunk('abc123')
    })

    act(() => {
      hookRef.clearPlaybackQueue()
    })

    expect(mockPlayerRelease).toHaveBeenCalled()
    expect(hookRef.playbackState).toBe('idle')
  })
})
