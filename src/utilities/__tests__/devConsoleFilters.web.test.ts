/** @jest-environment jsdom */

// __DEV__ is a React Native global. Jest does not define it; tests set it in beforeEach.
import {
  installGoogleIdentityConsoleFilter,
  resetGoogleIdentityConsoleFilterForTests,
} from '../devConsoleFilters.web'

describe('installGoogleIdentityConsoleFilter', () => {
  const hadOriginalDev = Object.prototype.hasOwnProperty.call(globalThis, '__DEV__')
  const originalDev = (globalThis as { __DEV__?: boolean }).__DEV__

  afterAll(() => {
    if (hadOriginalDev) {
      ;(globalThis as { __DEV__?: boolean }).__DEV__ = originalDev
      return
    }
    delete (globalThis as { __DEV__?: boolean }).__DEV__
  })

  let originalError: typeof console.error
  let originalWarn: typeof console.warn
  let errorSink: jest.Mock

  beforeEach(() => {
    ;(globalThis as { __DEV__?: boolean }).__DEV__ = true
    originalError = console.error
    originalWarn = console.warn
    errorSink = jest.fn()
    console.error = errorSink
    console.warn = jest.fn()
    resetGoogleIdentityConsoleFilterForTests()
    installGoogleIdentityConsoleFilter()
  })

  afterEach(() => {
    console.error = originalError
    console.warn = originalWarn
  })

  it('redirects [GSI_LOGGER] messages from console.error to console.warn', () => {
    console.error('[GSI_LOGGER]: FedCM get() rejects with AbortError')
    expect(console.warn).toHaveBeenCalledWith('[GSI_LOGGER]: FedCM get() rejects with AbortError')
    expect(errorSink).not.toHaveBeenCalled()
  })

  it("redirects the \"Provider's accounts list is empty.\" message to console.warn", () => {
    console.error("Provider's accounts list is empty.")
    expect(console.warn).toHaveBeenCalledWith("Provider's accounts list is empty.")
    expect(errorSink).not.toHaveBeenCalled()
  })

  it('passes non-GIS console.error calls through unchanged', () => {
    console.error('Something else went wrong', { detail: 42 })
    expect(errorSink).toHaveBeenCalledWith('Something else went wrong', { detail: 42 })
    expect(console.warn).not.toHaveBeenCalled()
  })

  it('is a no-op in production (__DEV__ === false)', () => {
    const sink = jest.fn()
    console.error = sink
    console.warn = jest.fn()
    resetGoogleIdentityConsoleFilterForTests()
    ;(global as any).__DEV__ = false
    installGoogleIdentityConsoleFilter()
    console.error('[GSI_LOGGER]: should not be filtered in prod')
    expect(sink).toHaveBeenCalledWith('[GSI_LOGGER]: should not be filtered in prod')
    ;(global as any).__DEV__ = true
  })
})
