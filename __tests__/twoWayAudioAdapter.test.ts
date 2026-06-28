const mockInitialize = jest.fn()
const mockPlayPCMData = jest.fn()
const mockToggleRecording = jest.fn()
const mockRequestMicPermissions = jest.fn()
const mockAddEventListener = jest.fn()
const mockTearDown = jest.fn()
const mockRestart = jest.fn()

jest.mock('@speechmatics/expo-two-way-audio', () => ({
  initialize: (...a: unknown[]) => mockInitialize(...a),
  playPCMData: (...a: unknown[]) => mockPlayPCMData(...a),
  toggleRecording: (...a: unknown[]) => mockToggleRecording(...a),
  requestMicrophonePermissionsAsync: (...a: unknown[]) => mockRequestMicPermissions(...a),
  addExpoTwoWayAudioEventListener: (...a: unknown[]) => mockAddEventListener(...a),
  tearDown: (...a: unknown[]) => mockTearDown(...a),
  restart: (...a: unknown[]) => mockRestart(...a),
}))

jest.mock('~/utils/audioResample', () => ({
  resample24to16: (input: Uint8Array) => input.subarray(0, Math.floor((input.length * 2) / 3)),
}))

import { TwoWayAudioAdapter } from '~/native/twoWayAudioAdapter'

describe('TwoWayAudioAdapter', () => {
  let adapter: TwoWayAudioAdapter

  beforeEach(() => {
    jest.clearAllMocks()
    mockInitialize.mockResolvedValue(undefined)
    mockTearDown.mockReturnValue(undefined)
    mockRestart.mockReturnValue(undefined)
    mockToggleRecording.mockReturnValue(true)
    mockRequestMicPermissions.mockResolvedValue({ granted: true })
    mockAddEventListener.mockReturnValue({ remove: jest.fn() })
    adapter = new TwoWayAudioAdapter()
  })

  test('initialize() calls module initialize', async () => {
    await adapter.initialize()
    expect(mockInitialize).toHaveBeenCalledTimes(1)
  })

  test('startRecording requests permissions before toggling recording', async () => {
    const onChunk = jest.fn()
    await adapter.startRecording(onChunk)
    expect(mockRequestMicPermissions).toHaveBeenCalled()
    expect(mockToggleRecording).toHaveBeenCalledWith(true)
  })

  test('startRecording returns false when permission denied', async () => {
    mockRequestMicPermissions.mockResolvedValue({ granted: false })
    const result = await adapter.startRecording(jest.fn())
    expect(result).toBe(false)
    expect(mockToggleRecording).not.toHaveBeenCalled()
  })

  test('startRecording returns true on success', async () => {
    const result = await adapter.startRecording(jest.fn())
    expect(result).toBe(true)
  })

  test('startRecording registers onMicrophoneData listener', async () => {
    const onChunk = jest.fn()
    await adapter.startRecording(onChunk)
    expect(mockAddEventListener).toHaveBeenCalledWith('onMicrophoneData', expect.any(Function))
  })

  test('mic listener converts Uint8Array to base64 and calls onChunk', async () => {
    let micListener: ((ev: { data: Uint8Array }) => void) | null = null
    mockAddEventListener.mockImplementation((event, cb) => {
      if (event === 'onMicrophoneData') micListener = cb
      return { remove: jest.fn() }
    })

    const onChunk = jest.fn()
    await adapter.startRecording(onChunk)

    const testData = new Uint8Array([72, 101, 108, 108, 111])
    micListener!({ data: testData })

    expect(onChunk).toHaveBeenCalledTimes(1)
    const b64 = onChunk.mock.calls[0][0]
    expect(typeof b64).toBe('string')
    const decoded = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    expect(Array.from(decoded)).toEqual(Array.from(testData))
  })

  test('stopRecording calls toggleRecording(false) and removes mic listener', async () => {
    const removeMock = jest.fn()
    mockAddEventListener.mockReturnValue({ remove: removeMock })
    await adapter.startRecording(jest.fn())
    adapter.stopRecording()
    expect(mockToggleRecording).toHaveBeenCalledWith(false)
    expect(removeMock).toHaveBeenCalled()
  })

  test('playChunk decodes base64, resamples, and calls playPCMData', () => {
    const raw = new Uint8Array([0, 1, 2, 3, 4, 5])
    const b64 = btoa(String.fromCharCode(...raw))
    adapter.playChunk(b64)
    expect(mockPlayPCMData).toHaveBeenCalledTimes(1)
    const arg = mockPlayPCMData.mock.calls[0][0]
    expect(arg).toBeInstanceOf(Uint8Array)
  })

  test('playChunk with malformed base64 does not throw and does not call playPCMData', () => {
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => adapter.playChunk('not!!valid!!base64!!')).not.toThrow()
    expect(mockPlayPCMData).not.toHaveBeenCalled()
    consoleWarnSpy.mockRestore()
  })

  test('clearPlaybackQueue calls restart()', () => {
    adapter.clearPlaybackQueue()
    expect(mockRestart).toHaveBeenCalled()
  })

  test('isPlaying() returns false initially', () => {
    expect(adapter.isPlaying()).toBe(false)
  })

  test('isPlaying() returns true immediately after playChunk', () => {
    const raw = new Uint8Array(64)
    const b64 = btoa(String.fromCharCode(...raw))
    adapter.playChunk(b64)
    expect(adapter.isPlaying()).toBe(true)
  })

  test('isPlaying() returns false after clearPlaybackQueue', () => {
    const raw = new Uint8Array(64)
    const b64 = btoa(String.fromCharCode(...raw))
    adapter.playChunk(b64)
    adapter.clearPlaybackQueue()
    expect(adapter.isPlaying()).toBe(false)
  })

  test('tearDown calls module tearDown', async () => {
    await adapter.tearDown()
    expect(mockTearDown).toHaveBeenCalled()
  })
})
