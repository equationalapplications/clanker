import React from 'react'
import { act, create } from 'react-test-renderer'
import { Alert } from 'react-native'

const mockUseCharacter = jest.fn()
const mockUseCurrentPlan = jest.fn()
const mockUseSelector = jest.fn()
const mockSendVoiceMessage = jest.fn()
const mockRouterPush = jest.fn()
const mockRequestPermissionsAsync = jest.fn()
const mockRequestRecordingPermissionsAsync = jest.fn()
const mockStart = jest.fn()
const mockStop = jest.fn()
const mockWriteAsStringAsync = jest.fn()
const mockDeleteAsync = jest.fn()
const mockRelease = jest.fn()
const mockPlay = jest.fn()
const mockAddListener = jest.fn()
const mockCancelAnimation = jest.fn()

const mockEventHandlers = new Map<string, Array<(payload: any) => void>>()

jest.mock('react-native', () => {
  return {
    Alert: {
      alert: jest.fn(),
    },
    Platform: {
      OS: 'ios',
    },
  }
})

jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockRouterPush(...args) },
}))

jest.mock('~/hooks/useCharacters', () => ({
  useCharacter: (...args: unknown[]) => mockUseCharacter(...args),
}))

jest.mock('~/hooks/useCurrentPlan', () => ({
  useCurrentPlan: (...args: unknown[]) => mockUseCurrentPlan(...args),
}))

jest.mock('@xstate/react', () => ({
  useSelector: (...args: unknown[]) => mockUseSelector(...args),
}))

jest.mock('~/hooks/useMachines', () => ({
  useAuthMachine: () => ({}),
}))

jest.mock('~/services/voiceChatService', () => ({
  sendVoiceMessage: (...args: unknown[]) => mockSendVoiceMessage(...args),
}))

jest.mock('~/hooks/useMessages', () => ({
  useChatMessages: () => [],
  messageKeys: {
    list: (characterId: string, userId: string) => ['messages', 'list', characterId, userId],
  },
}))

jest.mock('expo-speech-recognition', () => ({
  ExpoSpeechRecognitionModule: {
    requestPermissionsAsync: (...args: unknown[]) => mockRequestPermissionsAsync(...args),
    start: (...args: unknown[]) => mockStart(...args),
    stop: (...args: unknown[]) => mockStop(...args),
  },
  useSpeechRecognitionEvent: (eventName: string, listener: (payload: unknown) => void) => {
    const list = mockEventHandlers.get(eventName) || []
    list.push(listener)
    mockEventHandlers.set(eventName, list)
  },
}))

jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///tmp/',
  EncodingType: { Base64: 'base64' },
  writeAsStringAsync: (...args: unknown[]) => mockWriteAsStringAsync(...args),
  deleteAsync: (...args: unknown[]) => mockDeleteAsync(...args),
}))

jest.mock('expo-audio', () => ({
  createAudioPlayer: () => ({
    play: (...args: unknown[]) => mockPlay(...args),
    release: (...args: unknown[]) => mockRelease(...args),
    addListener: (...args: unknown[]) => mockAddListener(...args),
  }),
  requestRecordingPermissionsAsync: (...args: unknown[]) =>
    mockRequestRecordingPermissionsAsync(...args),
}))

jest.mock('react-native-reanimated', () => ({
  cancelAnimation: (...args: unknown[]) => mockCancelAnimation(...args),
  useSharedValue: (initial: number) => ({ value: initial }),
  withRepeat: (value: unknown) => value,
  withSequence: (...values: unknown[]) => values[0],
  withTiming: (value: unknown) => value,
}))

import { useVoiceChat } from '~/hooks/useVoiceChat'

function emitSpeechEvent(eventName: string, payload: unknown) {
  const listeners = mockEventHandlers.get(eventName) || []
  listeners.forEach((listener) => listener(payload))
}

function flushPromises() {
  return Promise.resolve()
}

describe('useVoiceChat', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers()
    mockEventHandlers.clear()

    mockUseCharacter.mockReturnValue({
      data: {
        id: 'char-1',
        name: 'Nova',
        appearance: 'avatar',
        traits: 'kind',
        emotions: 'calm',
        context: 'friendly',
        voice: 'Kore',
      },
      isLoading: false,
    })

    mockUseCurrentPlan.mockReturnValue({ isSubscriber: false, isLoading: false, remainingCredits: 10 })
    mockUseSelector.mockImplementation((_service: unknown, selector: (s: any) => unknown) =>
      selector({ context: { user: { uid: 'user-1' } } }),
    )

    mockRequestPermissionsAsync.mockResolvedValue({ granted: true })
    mockRequestRecordingPermissionsAsync.mockResolvedValue({ granted: true })
    mockSendVoiceMessage.mockResolvedValue({
      audioBase64: 'UklG',
      audioMimeType: 'audio/wav',
      replyText: 'voice reply',
      usageSnapshot: null,
    })

    mockWriteAsStringAsync.mockResolvedValue(undefined)
    mockDeleteAsync.mockResolvedValue(undefined)
    mockPlay.mockResolvedValue(undefined)
    mockAddListener.mockImplementation((_event: string, callback: (status: any) => void) => {
      callback({ didJustFinish: true })
      return { remove: jest.fn() }
    })
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  function renderHook() {
    let hookValue: ReturnType<typeof useVoiceChat> | null = null

    function Probe() {
      hookValue = useVoiceChat('char-1')
      return null
    }

    let tree: ReturnType<typeof create>
    act(() => {
      tree = create(<Probe />)
    })

    if (!hookValue) {
      throw new Error('hook value missing')
    }

    return {
      tree: tree!,
      getHookValue: () => {
        if (!hookValue) {
          throw new Error('hook value missing')
        }

        return hookValue
      },
    }
  }

  it('blocks when character has no voice set', async () => {
    mockUseCharacter.mockReturnValue({
      data: {
        id: 'char-1',
        name: 'Nova',
        voice: null,
      },
      isLoading: false,
    })

    const { getHookValue } = renderHook()

    act(() => {
      getHookValue().startListening()
    })

    expect(Alert.alert).toHaveBeenCalledWith(
      'No Voice Set',
      'This character has no voice selected. Go to character settings to choose one.',
      expect.any(Array),
    )
    expect(mockStart).not.toHaveBeenCalled()
  })

  it('blocks non-subscriber when remaining credits are below 2', () => {
    mockUseCurrentPlan.mockReturnValue({ isSubscriber: false, isLoading: false, remainingCredits: 1 })

    const { getHookValue } = renderHook()

    act(() => {
      getHookValue().startListening()
    })

    expect(Alert.alert).toHaveBeenCalledWith(
      'Insufficient Credits',
      'Voice replies cost 2 credits. Purchase more or subscribe for unlimited.',
      expect.any(Array),
    )
    expect(mockStart).not.toHaveBeenCalled()
  })

  it('allows non-subscriber when remainingCredits is null (still loading)', async () => {
    mockUseCurrentPlan.mockReturnValue({ isSubscriber: false, isLoading: true, remainingCredits: null })

    const { getHookValue } = renderHook()

    await act(async () => {
      await getHookValue().startListening()
      await flushPromises()
    })

    expect(Alert.alert).not.toHaveBeenCalledWith(
      'Insufficient Credits',
      expect.any(String),
      expect.any(Array),
    )
    expect(mockStart).toHaveBeenCalled()
  })

  it('allows subscriber with zero credits', async () => {
    mockUseCurrentPlan.mockReturnValue({ isSubscriber: true, isLoading: false, remainingCredits: 0 })

    const { getHookValue } = renderHook()

    await act(async () => {
      await getHookValue().startListening()
      await flushPromises()
    })

    expect(mockStart).toHaveBeenCalled()
  })

  it('sets error when permissions are denied and retries on next tap', async () => {
    mockRequestPermissionsAsync.mockResolvedValueOnce({ granted: false })

    const { getHookValue } = renderHook()

    await act(async () => {
      await getHookValue().startListening()
      await flushPromises()
    })

    expect(getHookValue().voiceState).toBe('error')

    await act(async () => {
      await getHookValue().startListening()
      await flushPromises()
    })

    expect(mockStart).toHaveBeenCalledTimes(1)
  })

  it('sets error when audio recording permission is denied', async () => {
    mockRequestRecordingPermissionsAsync.mockResolvedValueOnce({ granted: false })

    const { getHookValue } = renderHook()

    await act(async () => {
      await getHookValue().startListening()
      await flushPromises()
    })

    expect(getHookValue().voiceState).toBe('error')
    expect(mockStart).not.toHaveBeenCalled()
  })

  it('blocks double-tap while listening (re-entrancy guard)', async () => {
    const { getHookValue } = renderHook()

    // Start listening (state transitions to listening)
    await act(async () => {
      await getHookValue().startListening()
      await flushPromises()
    })

    expect(getHookValue().voiceState).toBe('listening')

    // Second tap while already listening — should be a no-op
    await act(async () => {
      await getHookValue().startListening()
      await flushPromises()
    })

    // Only one STT session should have been started
    expect(mockStart).toHaveBeenCalledTimes(1)
  })

  it('returns to idle on empty transcription without API call', async () => {
    const { getHookValue } = renderHook()

    await act(async () => {
      await getHookValue().startListening()
      emitSpeechEvent('result', { isFinal: true, results: [{ transcript: '   ' }] })
      emitSpeechEvent('end', {})
      await flushPromises()
    })

    expect(mockSendVoiceMessage).not.toHaveBeenCalled()
    expect(getHookValue().voiceState).toBe('idle')
  })

  it('stops recognition when MAX_LISTEN_MS timer fires', async () => {
    const { getHookValue } = renderHook()
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout')

    await act(async () => {
      await getHookValue().startListening()
      await flushPromises()
    })

    act(() => {
      const timeoutCallback = setTimeoutSpy.mock.calls[0]?.[0] as (() => void) | undefined
      timeoutCallback?.()
    })

    expect(mockStop).toHaveBeenCalledTimes(1)
    setTimeoutSpy.mockRestore()
  })

  it('runs happy path including temp-file write and playback', async () => {
    const { getHookValue } = renderHook()

    await act(async () => {
      await getHookValue().startListening()
      emitSpeechEvent('result', { isFinal: true, results: [{ transcript: 'hello there' }] })
      emitSpeechEvent('end', {})
      await flushPromises()
      await flushPromises()
    })

    expect(mockSendVoiceMessage).toHaveBeenCalledWith(
      'hello there',
      expect.objectContaining({ id: 'char-1' }),
      'user-1',
      expect.any(Array),
    )
    expect(mockWriteAsStringAsync).toHaveBeenCalled()
    expect(mockPlay).toHaveBeenCalled()
    expect(mockDeleteAsync).toHaveBeenCalled()
    expect(getHookValue().voiceState).toBe('idle')
  })

  it('skips playback after unmount during processing', async () => {
    let resolveVoice: ((value: any) => void) | null = null
    mockSendVoiceMessage.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveVoice = resolve
        }),
    )

    const { getHookValue, tree } = renderHook()

    await act(async () => {
      await getHookValue().startListening()
      emitSpeechEvent('result', { isFinal: true, results: [{ transcript: 'hello there' }] })
      emitSpeechEvent('end', {})
      await flushPromises()
    })

    act(() => {
      tree.unmount()
    })

    await act(async () => {
      resolveVoice?.({
        audioBase64: 'UklG',
        audioMimeType: 'audio/wav',
        replyText: 'voice reply',
        usageSnapshot: null,
      })
      await flushPromises()
    })

    expect(mockPlay).not.toHaveBeenCalled()
  })

  it('cancel during playing releases player and deletes temp file', async () => {
    const { getHookValue } = renderHook()

    await act(async () => {
      await getHookValue().startListening()
      emitSpeechEvent('result', { isFinal: true, results: [{ transcript: 'hello there' }] })
      emitSpeechEvent('end', {})
      await flushPromises()
    })

    act(() => {
      getHookValue().cancel()
    })

    expect(mockRelease).toHaveBeenCalled()
    expect(mockDeleteAsync).toHaveBeenCalled()
  })

  it('moves to error and cleans file on playback failure', async () => {
    mockPlay.mockRejectedValueOnce(new Error('playback failed'))

    const { getHookValue } = renderHook()

    await act(async () => {
      await getHookValue().startListening()
      emitSpeechEvent('result', { isFinal: true, results: [{ transcript: 'hello there' }] })
      emitSpeechEvent('end', {})
      await flushPromises()
    })

    expect(getHookValue().voiceState).toBe('error')
    expect(mockDeleteAsync).toHaveBeenCalled()
  })
})
