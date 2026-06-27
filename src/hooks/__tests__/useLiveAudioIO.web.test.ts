import { renderHook, act } from '@testing-library/react-native'
import { useLiveAudioIO } from '../useLiveAudioIO.web'

// ─── Mock factory helpers ────────────────────────────────────────────────────

function makeMockTrack() {
  return { stop: jest.fn(), kind: 'audio', enabled: true }
}

function makeMockStream(tracks = [makeMockTrack()]) {
  return { getTracks: jest.fn(() => tracks) }
}

function makeMockSourceNode() {
  return {
    connect: jest.fn(),
    disconnect: jest.fn(),
  }
}

let mockWorkletNode: {
  port: { onmessage: ((event: MessageEvent) => void) | null; postMessage: jest.Mock }
  connect: jest.Mock
  disconnect: jest.Mock
}

let mockCtx: {
  state: AudioContextState
  sampleRate: number
  currentTime: number
  destination: Record<string, never>
  audioWorklet: { addModule: jest.Mock }
  createMediaStreamSource: jest.Mock
  createBufferSource: jest.Mock
  createBuffer: jest.Mock
  close: jest.Mock
  resume: jest.Mock
}

let mockStream: ReturnType<typeof makeMockStream>

// ─── Setup / teardown ────────────────────────────────────────────────────────

beforeEach(() => {
  mockStream = makeMockStream()

  mockWorkletNode = {
    port: { onmessage: null, postMessage: jest.fn() },
    connect: jest.fn(),
    disconnect: jest.fn(),
  }

  mockCtx = {
    state: 'running',
    sampleRate: 16000,
    currentTime: 0,
    destination: {},
    audioWorklet: { addModule: jest.fn().mockResolvedValue(undefined) },
    createMediaStreamSource: jest.fn(() => makeMockSourceNode()),
    createBufferSource: jest.fn(() => {
      const node = {
        buffer: null as unknown,
        connect: jest.fn(),
        start: jest.fn(),
        stop: jest.fn(),
        onended: null as (() => void) | null,
      }
      return node
    }),
    createBuffer: jest.fn((channels: number, length: number, sampleRate: number) => {
      const data = new Float32Array(length)
      return {
        duration: length / sampleRate,
        getChannelData: jest.fn(() => data),
      }
    }),
    close: jest.fn().mockResolvedValue(undefined),
    resume: jest.fn().mockImplementation(() => {
      mockCtx.state = 'running'
      return Promise.resolve()
    }),
  }

  Object.defineProperty(window, 'AudioContext', {
    value: jest.fn(() => mockCtx),
    writable: true,
    configurable: true,
  })

  Object.defineProperty(window, 'AudioWorkletNode', {
    value: jest.fn(() => mockWorkletNode),
    writable: true,
    configurable: true,
  })

  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: jest.fn().mockResolvedValue(mockStream) },
    writable: true,
    configurable: true,
  })

  jest.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-worklet')
  jest.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
})

afterEach(() => {
  jest.restoreAllMocks()
})

// ─── startRecording ──────────────────────────────────────────────────────────

describe('startRecording', () => {
  it('returns true and sets recordingState to recording on success', async () => {
    const { result } = renderHook(() => useLiveAudioIO())

    let started: boolean | undefined
    await act(async () => {
      started = await result.current.startRecording()
    })

    expect(started).toBe(true)
    expect(result.current.recordingState).toBe('recording')
    expect(result.current.error).toBeNull()
  })

  it('creates AudioContext at 16kHz sample rate', async () => {
    const { result } = renderHook(() => useLiveAudioIO())
    await act(async () => { await result.current.startRecording() })

    expect(window.AudioContext).toHaveBeenCalledWith({ sampleRate: 16000 })
  })

  it('calls getUserMedia with mono + echoCancellation + noiseSuppression', async () => {
    const { result } = renderHook(() => useLiveAudioIO())
    await act(async () => { await result.current.startRecording() })

    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    })
  })

  it('loads AudioWorklet via Blob URL and revokes it afterward', async () => {
    const { result } = renderHook(() => useLiveAudioIO())
    await act(async () => { await result.current.startRecording() })

    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
    expect(mockCtx.audioWorklet.addModule).toHaveBeenCalledWith('blob:mock-worklet')
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-worklet')
  })

  it('connects MediaStreamSource to AudioWorkletNode', async () => {
    const { result } = renderHook(() => useLiveAudioIO())
    await act(async () => { await result.current.startRecording() })

    const sourceNode = mockCtx.createMediaStreamSource.mock.results[0].value
    expect(sourceNode.connect).toHaveBeenCalledWith(mockWorkletNode)
  })

  it('connects AudioWorkletNode to AudioContext destination so graph pulls audio through it', async () => {
    const { result } = renderHook(() => useLiveAudioIO())
    await act(async () => { await result.current.startRecording() })

    expect(mockWorkletNode.connect).toHaveBeenCalledWith(mockCtx.destination)
  })

  it('resumes AudioContext when suspended before connecting the graph', async () => {
    mockCtx.state = 'suspended'
    const { result } = renderHook(() => useLiveAudioIO())
    await act(async () => { await result.current.startRecording() })

    expect(mockCtx.resume).toHaveBeenCalledTimes(1)
  })
})

// ─── onAudioChunk ────────────────────────────────────────────────────────────

describe('onAudioChunk', () => {
  it('fires registered listener with base64 string when worklet posts PCM data', async () => {
    const { result } = renderHook(() => useLiveAudioIO())
    await act(async () => { await result.current.startRecording() })

    const received: string[] = []
    result.current.onAudioChunk((chunk) => received.push(chunk))

    // Simulate worklet sending 320-sample Int16 buffer
    const int16 = new Int16Array(320).fill(1000)
    act(() => {
      mockWorkletNode.port.onmessage!({ data: int16.buffer } as MessageEvent)
    })

    expect(received).toHaveLength(1)
    expect(typeof received[0]).toBe('string')
    expect(received[0].length).toBeGreaterThan(0)
  })

  it('unsubscribes listener when returned cleanup is called', async () => {
    const { result } = renderHook(() => useLiveAudioIO())
    await act(async () => { await result.current.startRecording() })

    const received: string[] = []
    let unsubscribe!: () => void
    act(() => {
      unsubscribe = result.current.onAudioChunk((chunk) => received.push(chunk))
    })
    act(() => { unsubscribe() })

    const int16 = new Int16Array(320).fill(500)
    act(() => {
      mockWorkletNode.port.onmessage!({ data: int16.buffer } as MessageEvent)
    })

    expect(received).toHaveLength(0)
  })
})

// ─── stopRecording ───────────────────────────────────────────────────────────

describe('stopRecording', () => {
  it('stops all MediaStream tracks', async () => {
    const track = makeMockTrack()
    mockStream = makeMockStream([track])
    ;(navigator.mediaDevices.getUserMedia as jest.Mock).mockResolvedValue(mockStream)

    const { result } = renderHook(() => useLiveAudioIO())
    await act(async () => { await result.current.startRecording() })
    act(() => { result.current.stopRecording() })

    expect(track.stop).toHaveBeenCalledTimes(1)
  })

  it('disconnects worklet node', async () => {
    const { result } = renderHook(() => useLiveAudioIO())
    await act(async () => { await result.current.startRecording() })
    act(() => { result.current.stopRecording() })

    expect(mockWorkletNode.disconnect).toHaveBeenCalledTimes(1)
  })

  it('closes AudioContext', async () => {
    const { result } = renderHook(() => useLiveAudioIO())
    await act(async () => { await result.current.startRecording() })
    act(() => { result.current.stopRecording() })

    expect(mockCtx.close).toHaveBeenCalledTimes(1)
  })

  it('sets recordingState back to idle', async () => {
    const { result } = renderHook(() => useLiveAudioIO())
    await act(async () => { await result.current.startRecording() })
    act(() => { result.current.stopRecording() })

    expect(result.current.recordingState).toBe('idle')
  })
})

// ─── playChunk ───────────────────────────────────────────────────────────────

// Helper: encode a silent 24kHz PCM chunk as base64
function makeSilentChunk(samples = 480): string {
  const int16 = new Int16Array(samples) // all zeros = silence
  return btoa(String.fromCharCode(...new Uint8Array(int16.buffer)))
}

describe('playChunk', () => {
  async function startAndGetNode() {
    const { result } = renderHook(() => useLiveAudioIO())
    await act(async () => { await result.current.startRecording() })
    return result
  }

  it('creates an AudioBuffer at 24kHz', async () => {
    const result = await startAndGetNode()
    await act(async () => { await result.current.playChunk(makeSilentChunk()) })

    expect(mockCtx.createBuffer).toHaveBeenCalledWith(1, expect.any(Number), 24000)
  })

  it('schedules first chunk at currentTime', async () => {
    mockCtx.currentTime = 1.0
    const result = await startAndGetNode()
    await act(async () => { await result.current.playChunk(makeSilentChunk()) })

    const node = mockCtx.createBufferSource.mock.results[0].value
    expect(node.start).toHaveBeenCalledWith(1.0)
  })

  it('schedules second chunk immediately after first (gapless)', async () => {
    mockCtx.currentTime = 0
    // createBuffer returns duration = samples / sampleRate = 480 / 24000 = 0.02s
    const result = await startAndGetNode()
    await act(async () => {
      await result.current.playChunk(makeSilentChunk(480)) // 0.02s
      await result.current.playChunk(makeSilentChunk(480))
    })

    const nodes = mockCtx.createBufferSource.mock.results
    expect(nodes[0].value.start).toHaveBeenCalledWith(0)
    expect(nodes[1].value.start).toHaveBeenCalledWith(expect.closeTo(0.02, 5))
  })

  it('sets playbackState to playing', async () => {
    const result = await startAndGetNode()
    await act(async () => { await result.current.playChunk(makeSilentChunk()) })

    expect(result.current.playbackState).toBe('playing')
  })

  it('removes node from scheduledNodes on ended and sets idle when queue empty', async () => {
    const result = await startAndGetNode()
    await act(async () => { await result.current.playChunk(makeSilentChunk()) })

    const node = mockCtx.createBufferSource.mock.results[0].value
    // Simulate natural end of playback
    act(() => { node.onended?.() })

    expect(result.current.playbackState).toBe('idle')
  })

  it('does not throw on malformed base64 — skips chunk silently', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const result = await startAndGetNode()

    await expect(
      act(async () => { await result.current.playChunk('not-valid-base64!!!') })
    ).resolves.not.toThrow()

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/\[useLiveAudioIO\.web\].*playChunk error/),
      expect.anything(),
    )
    warnSpy.mockRestore()
  })

  it('resumes AudioContext when suspended before scheduling playback', async () => {
    const result = await startAndGetNode()
    mockCtx.resume.mockClear()
    mockCtx.state = 'suspended'
    await act(async () => { await result.current.playChunk(makeSilentChunk()) })

    expect(mockCtx.resume).toHaveBeenCalledTimes(1)
  })
})

// ─── clearPlaybackQueue ──────────────────────────────────────────────────────

describe('clearPlaybackQueue', () => {
  it('calls stop() on all scheduled nodes', async () => {
    const { result } = renderHook(() => useLiveAudioIO())
    await act(async () => { await result.current.startRecording() })
    await act(async () => {
      await result.current.playChunk(makeSilentChunk())
      await result.current.playChunk(makeSilentChunk())
    })

    act(() => { result.current.clearPlaybackQueue() })

    const nodes = mockCtx.createBufferSource.mock.results
    expect(nodes[0].value.stop).toHaveBeenCalledTimes(1)
    expect(nodes[1].value.stop).toHaveBeenCalledTimes(1)
  })

  it('sets playbackState to idle', async () => {
    const { result } = renderHook(() => useLiveAudioIO())
    await act(async () => { await result.current.startRecording() })
    await act(async () => { await result.current.playChunk(makeSilentChunk()) })
    act(() => { result.current.clearPlaybackQueue() })

    expect(result.current.playbackState).toBe('idle')
  })

  it('resets nextStartTime so next chunk schedules from currentTime', async () => {
    const { result } = renderHook(() => useLiveAudioIO())
    await act(async () => { await result.current.startRecording() })

    mockCtx.currentTime = 5.0
    await act(async () => { await result.current.playChunk(makeSilentChunk(480)) })
    // nextStartTime is now 5.02s

    act(() => { result.current.clearPlaybackQueue() })

    mockCtx.currentTime = 6.0
    await act(async () => { await result.current.playChunk(makeSilentChunk(480)) })

    // After clear, nextStartTime was reset to 0; clamped to currentTime (6.0)
    const nodes = mockCtx.createBufferSource.mock.results
    const lastNode = nodes[nodes.length - 1].value
    expect(lastNode.start).toHaveBeenCalledWith(6.0)
  })
})

// ─── Error paths ─────────────────────────────────────────────────────────────

describe('error handling', () => {
  it('sets error and returns false when getUserMedia permission is denied', async () => {
    ;(navigator.mediaDevices.getUserMedia as jest.Mock).mockRejectedValue(
      new Error('Permission denied')
    )

    const { result } = renderHook(() => useLiveAudioIO())
    let started: boolean | undefined
    await act(async () => { started = await result.current.startRecording() })

    expect(started).toBe(false)
    expect(result.current.recordingState).toBe('error')
    expect(result.current.error).toBe('Microphone permission required.')
  })

  it('sets error and returns false when getUserMedia is unavailable (non-HTTPS)', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: undefined,
      writable: true,
      configurable: true,
    })

    const { result } = renderHook(() => useLiveAudioIO())
    let started: boolean | undefined
    await act(async () => { started = await result.current.startRecording() })

    expect(started).toBe(false)
    expect(result.current.recordingState).toBe('error')
    expect(result.current.error).toBe('Microphone access requires a secure connection (HTTPS).')
  })

  it('sets error and returns false when AudioContext sampleRate is not 16kHz', async () => {
    mockCtx.sampleRate = 48000

    const { result } = renderHook(() => useLiveAudioIO())
    let started: boolean | undefined
    await act(async () => { started = await result.current.startRecording() })

    expect(started).toBe(false)
    expect(result.current.recordingState).toBe('error')
    expect(result.current.error).toBe(
      'Browser did not honor 16000Hz AudioContext sampleRate (got 48000Hz).',
    )
  })

  it('sets error and returns false when AudioWorklet is not supported', async () => {
    mockCtx.audioWorklet.addModule.mockRejectedValue(new Error('Not supported'))

    const { result } = renderHook(() => useLiveAudioIO())
    let started: boolean | undefined
    await act(async () => { started = await result.current.startRecording() })

    expect(started).toBe(false)
    expect(result.current.recordingState).toBe('error')
    expect(result.current.error).toBe(
      'Browser does not support AudioWorklet. Use Chrome, Firefox, or Safari 15+.'
    )
  })

  it('stops stream and closes context when AudioWorklet fails', async () => {
    const track = makeMockTrack()
    mockStream = makeMockStream([track])
    ;(navigator.mediaDevices.getUserMedia as jest.Mock).mockResolvedValue(mockStream)
    mockCtx.audioWorklet.addModule.mockRejectedValue(new Error('Not supported'))

    const { result } = renderHook(() => useLiveAudioIO())
    await act(async () => { await result.current.startRecording() })

    expect(track.stop).toHaveBeenCalledTimes(1)
    expect(mockCtx.close).toHaveBeenCalledTimes(1)
  })

  it('clears audio context refs when AudioWorklet fails so playChunk is a no-op', async () => {
    mockCtx.audioWorklet.addModule.mockRejectedValue(new Error('Not supported'))

    const { result } = renderHook(() => useLiveAudioIO())
    await act(async () => { await result.current.startRecording() })

    await act(async () => { await result.current.playChunk(makeSilentChunk()) })

    expect(mockCtx.createBuffer).not.toHaveBeenCalled()
  })

  it('does not throw when AudioContext.close rejects during stopRecording', async () => {
    mockCtx.close.mockRejectedValue(new Error('Already closed'))

    const { result } = renderHook(() => useLiveAudioIO())
    await act(async () => { await result.current.startRecording() })

    expect(() => {
      act(() => { result.current.stopRecording() })
    }).not.toThrow()
  })

  it('stops stream and closes context when graph setup fails after getUserMedia', async () => {
    const track = makeMockTrack()
    mockStream = makeMockStream([track])
    ;(navigator.mediaDevices.getUserMedia as jest.Mock).mockResolvedValue(mockStream)
    ;(window.AudioWorkletNode as jest.Mock).mockImplementationOnce(() => {
      throw new Error('Worklet node failed')
    })

    const { result } = renderHook(() => useLiveAudioIO())
    let started: boolean | undefined
    await act(async () => { started = await result.current.startRecording() })

    expect(started).toBe(false)
    expect(result.current.recordingState).toBe('error')
    expect(track.stop).toHaveBeenCalledTimes(1)
    expect(mockCtx.close).toHaveBeenCalledTimes(1)
  })
})

// ─── Unmount cleanup ─────────────────────────────────────────────────────────

describe('unmount cleanup', () => {
  it('stops all tracks and closes AudioContext when hook unmounts during active recording', async () => {
    const track = makeMockTrack()
    mockStream = makeMockStream([track])
    ;(navigator.mediaDevices.getUserMedia as jest.Mock).mockResolvedValue(mockStream)

    const { result, unmount } = renderHook(() => useLiveAudioIO())
    await act(async () => { await result.current.startRecording() })

    act(() => { unmount() })

    expect(track.stop).toHaveBeenCalledTimes(1)
    expect(mockCtx.close).toHaveBeenCalledTimes(1)
  })

  it('stops scheduled playback nodes when hook unmounts', async () => {
    const { result, unmount } = renderHook(() => useLiveAudioIO())
    await act(async () => { await result.current.startRecording() })
    await act(async () => { await result.current.playChunk(makeSilentChunk()) })

    act(() => { unmount() })

    const node = mockCtx.createBufferSource.mock.results[0].value
    expect(node.stop).toHaveBeenCalledTimes(1)
  })
})
