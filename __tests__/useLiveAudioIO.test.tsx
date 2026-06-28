import React from 'react'
import { act, create } from 'react-test-renderer'

const mockInitialize = jest.fn()
const mockStartRecording = jest.fn()
const mockStopRecording = jest.fn()
const mockPlayChunk = jest.fn()
const mockClearPlaybackQueue = jest.fn()
const mockIsPlaying = jest.fn()
const mockTearDown = jest.fn()

let capturedOnChunk: ((base64: string) => void) | null = null

jest.mock('~/native/twoWayAudioAdapter', () => ({
  TwoWayAudioAdapter: jest.fn().mockImplementation(() => ({
    initialize: mockInitialize,
    startRecording: (cb: (base64: string) => void) => {
      capturedOnChunk = cb
      return mockStartRecording(cb)
    },
    stopRecording: mockStopRecording,
    playChunk: mockPlayChunk,
    clearPlaybackQueue: mockClearPlaybackQueue,
    isPlaying: mockIsPlaying,
    tearDown: mockTearDown,
  })),
}))

import { useLiveAudioIO } from '~/hooks/useLiveAudioIO'

let hookRef: ReturnType<typeof useLiveAudioIO>

function TestHarness() {
  hookRef = useLiveAudioIO()
  return null
}

let activeRenderer: ReturnType<typeof create> | null = null

async function mountHarness(): Promise<ReturnType<typeof create>> {
  let renderer!: ReturnType<typeof create>
  await act(async () => {
    renderer = create(<TestHarness />)
  })
  activeRenderer = renderer
  return renderer
}

describe('useLiveAudioIO', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    capturedOnChunk = null
    activeRenderer = null
    mockInitialize.mockResolvedValue(undefined)
    mockStartRecording.mockResolvedValue(true)
    mockStopRecording.mockReturnValue(undefined)
    mockPlayChunk.mockReturnValue(undefined)
    mockClearPlaybackQueue.mockReturnValue(undefined)
    mockIsPlaying.mockReturnValue(false)
    mockTearDown.mockResolvedValue(undefined)
  })

  afterEach(async () => {
    if (activeRenderer) {
      await act(async () => {
        activeRenderer!.unmount()
      })
      activeRenderer = null
    }
  })

  test('mounts: adapter.initialize() called on mount', async () => {
    await mountHarness()
    expect(mockInitialize).toHaveBeenCalledTimes(1)
  })

  test('startRecording calls adapter.startRecording and sets recordingState', async () => {
    await mountHarness()

    await act(async () => {
      await hookRef.startRecording()
    })

    expect(mockStartRecording).toHaveBeenCalled()
    expect(hookRef.recordingState).toBe('recording')
  })

  test('startRecording with denied permission sets error state', async () => {
    mockStartRecording.mockResolvedValue(false)

    await mountHarness()

    await act(async () => {
      await hookRef.startRecording()
    })

    expect(hookRef.recordingState).toBe('error')
    expect(hookRef.error).toMatch(/permission/i)
  })

  test('onAudioChunk fires when adapter emits mic data', async () => {
    await mountHarness()

    const received: string[] = []
    hookRef.onAudioChunk((chunk) => received.push(chunk))

    await act(async () => {
      await hookRef.startRecording()
    })

    act(() => {
      capturedOnChunk?.('base64audiodata')
    })

    expect(received).toEqual(['base64audiodata'])
  })

  test('onAudioChunk fan-out: multiple subscribers all receive chunks', async () => {
    await mountHarness()

    const received1: string[] = []
    const received2: string[] = []
    hookRef.onAudioChunk((c) => received1.push(c))
    hookRef.onAudioChunk((c) => received2.push(c))

    await act(async () => {
      await hookRef.startRecording()
    })

    act(() => {
      capturedOnChunk?.('chunk1')
    })

    expect(received1).toEqual(['chunk1'])
    expect(received2).toEqual(['chunk1'])
  })

  test('onAudioChunk returns unsubscribe function', async () => {
    await mountHarness()

    await act(async () => {
      await hookRef.startRecording()
    })

    const received: string[] = []
    const unsub = hookRef.onAudioChunk((c) => received.push(c))
    unsub()

    act(() => {
      capturedOnChunk?.('after-unsub')
    })

    expect(received).toEqual([])
  })

  test('playChunk forwards base64 to adapter and sets playbackState playing', async () => {
    await mountHarness()

    await act(async () => {
      await hookRef.playChunk('abc123')
    })

    expect(mockPlayChunk).toHaveBeenCalledWith('abc123')
    expect(hookRef.playbackState).toBe('playing')
  })

  test('playbackState returns idle when adapter.isPlaying() becomes false (natural drain)', async () => {
    jest.useFakeTimers()
    mockIsPlaying.mockReturnValue(true)

    await mountHarness()

    await act(async () => {
      await hookRef.playChunk('abc123')
    })

    expect(hookRef.playbackState).toBe('playing')

    mockIsPlaying.mockReturnValue(false)

    await act(async () => {
      jest.advanceTimersByTime(100)
    })

    expect(hookRef.playbackState).toBe('idle')
    jest.useRealTimers()
  })

  test('clearPlaybackQueue calls adapter clear and sets playbackState idle', async () => {
    await mountHarness()

    await act(async () => {
      await hookRef.playChunk('abc123')
    })

    act(() => {
      hookRef.clearPlaybackQueue()
    })

    expect(mockClearPlaybackQueue).toHaveBeenCalled()
    expect(hookRef.playbackState).toBe('idle')
  })

  test('stopRecording calls adapter.stopRecording and sets recordingState idle', async () => {
    await mountHarness()

    await act(async () => {
      await hookRef.startRecording()
    })

    act(() => {
      hookRef.stopRecording()
    })

    expect(mockStopRecording).toHaveBeenCalled()
    expect(hookRef.recordingState).toBe('idle')
  })

  test('unmount calls adapter.tearDown()', async () => {
    const renderer = await mountHarness()

    await act(async () => {
      renderer.unmount()
    })
    activeRenderer = null

    expect(mockTearDown).toHaveBeenCalled()
  })
})
