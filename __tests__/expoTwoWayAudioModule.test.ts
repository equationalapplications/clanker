/**
 * Guard tests for the vendored module's JS surface (clanker #857).
 *
 * The dangerous regression class here is the forked `restart()` trap: the
 * old patch redefined `restart()` to mean barge-in while the app believed
 * it kept upstream semantics. The vendored module must therefore never
 * export `restart` at all, and `bargeIn()` must delegate to the native
 * method without touching recording state.
 */

const mockNativeBargeIn = jest.fn()
const mockNativeToggleRecording = jest.fn()

jest.mock('../modules/expo-two-way-audio/src/ExpoTwoWayAudioModule', () => ({
  __esModule: true,
  default: {
    bargeIn: (...a: unknown[]) => mockNativeBargeIn(...a),
    toggleRecording: (...a: unknown[]) => mockNativeToggleRecording(...a),
  },
}))

import * as ExpoTwoWayAudio from '../modules/expo-two-way-audio/src'

describe('vendored expo-two-way-audio JS surface', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('does not export restart (the forked alias is a trap)', () => {
    expect((ExpoTwoWayAudio as Record<string, unknown>).restart).toBeUndefined()
  })

  test('bargeIn() delegates to the native method', () => {
    ExpoTwoWayAudio.bargeIn()
    expect(mockNativeBargeIn).toHaveBeenCalledTimes(1)
  })

  test('bargeIn() never touches recording state', () => {
    ExpoTwoWayAudio.bargeIn()
    expect(mockNativeToggleRecording).not.toHaveBeenCalled()
  })
})
