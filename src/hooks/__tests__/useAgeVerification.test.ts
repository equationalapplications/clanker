import { renderHook, act } from '@testing-library/react-native'
import { Platform } from 'react-native'
import * as AgeRange from 'expo-age-range'
import { useAgeVerification } from '../useAgeVerification'

jest.mock('expo-age-range', () => ({
  requestAgeRangeAsync: jest.fn(),
  isEligibleForAgeFeaturesAsync: jest.fn(),
  requestAgeSignalsAccessAsync: jest.fn(),
}))

const mockRequestAgeRange = AgeRange.requestAgeRangeAsync as jest.Mock
const mockIsEligible = AgeRange.isEligibleForAgeFeaturesAsync as jest.Mock
const mockRequestSignalsAccess = AgeRange.requestAgeSignalsAccessAsync as jest.Mock

function setup() {
  const onVerified = jest.fn()
  const onRejected = jest.fn()
  const result = renderHook(() => useAgeVerification({ onVerified, onRejected }))
  return { ...result, onVerified, onRejected }
}

let originalVersionDescriptor: PropertyDescriptor | undefined

function setVersion(version: string) {
  if (!originalVersionDescriptor) {
    originalVersionDescriptor = Object.getOwnPropertyDescriptor(Platform, 'Version') ?? {
      value: Platform.Version,
      configurable: true,
      writable: true,
    }
  }
  Object.defineProperty(Platform, 'Version', {
    value: version,
    configurable: true,
    writable: true,
  })
}

function resetPlatformVersion() {
  if (originalVersionDescriptor) {
    Object.defineProperty(Platform, 'Version', originalVersionDescriptor)
    originalVersionDescriptor = undefined
  }
}

beforeEach(() => {
  jest.clearAllMocks()
})

afterEach(() => {
  __resetJestPlatformOS()
  resetPlatformVersion()
})

describe('web', () => {
  beforeEach(() => __setJestPlatformOS('web'))

  it('sets showDobPicker immediately without calling native APIs', async () => {
    const { result, onVerified, onRejected } = setup()
    await act(() => result.current.verifyAge())
    expect(result.current.showDobPicker).toBe(true)
    expect(result.current.isVerifying).toBe(false)
    expect(mockRequestAgeRange).not.toHaveBeenCalled()
    expect(onVerified).not.toHaveBeenCalled()
    expect(onRejected).not.toHaveBeenCalled()
  })
})

describe('iOS < 26', () => {
  beforeEach(() => {
    __setJestPlatformOS('ios')
    setVersion('17.5')
  })

  it('sets showDobPicker immediately without calling native APIs', async () => {
    const { result, onVerified, onRejected } = setup()
    await act(() => result.current.verifyAge())
    expect(result.current.showDobPicker).toBe(true)
    expect(result.current.isVerifying).toBe(false)
    expect(mockRequestAgeRange).not.toHaveBeenCalled()
    expect(onVerified).not.toHaveBeenCalled()
    expect(onRejected).not.toHaveBeenCalled()
  })
})

describe('iOS >= 26', () => {
  beforeEach(() => {
    __setJestPlatformOS('ios')
    setVersion('26.0')
  })

  it('shows the DOB picker when isEligible is false (no verified age signal available)', async () => {
    mockIsEligible.mockResolvedValue(false)
    const { result, onVerified } = setup()
    await act(() => result.current.verifyAge())
    // `false` = regulation does not apply in this region, NOT "user is an adult".
    // No verified age signal exists, so the manual DOB check is required.
    expect(result.current.showDobPicker).toBe(true)
    expect(onVerified).not.toHaveBeenCalled()
    expect(mockRequestAgeRange).not.toHaveBeenCalled()
    expect(result.current.isVerifying).toBe(false)
  })

  it('calls onVerified when isEligible is null and lowerBound >= 18', async () => {
    mockIsEligible.mockResolvedValue(null)
    mockRequestAgeRange.mockResolvedValue({ lowerBound: 18, upperBound: null })
    const { result, onVerified } = setup()
    await act(() => result.current.verifyAge())
    expect(onVerified).toHaveBeenCalledTimes(1)
    expect(result.current.isVerifying).toBe(false)
  })

  it('calls onVerified when isEligible is true and lowerBound >= 18', async () => {
    mockIsEligible.mockResolvedValue(true)
    mockRequestAgeRange.mockResolvedValue({ lowerBound: 18, upperBound: null })
    const { result, onVerified } = setup()
    await act(() => result.current.verifyAge())
    expect(onVerified).toHaveBeenCalledTimes(1)
    expect(result.current.isVerifying).toBe(false)
  })

  it('calls onRejected when lowerBound < 18', async () => {
    mockIsEligible.mockResolvedValue(true)
    mockRequestAgeRange.mockResolvedValue({ lowerBound: 17, upperBound: 17 })
    const { result, onRejected } = setup()
    await act(() => result.current.verifyAge())
    expect(onRejected).toHaveBeenCalledTimes(1)
    expect(result.current.isVerifying).toBe(false)
  })

  it('shows DOB picker when lowerBound is null', async () => {
    mockIsEligible.mockResolvedValue(true)
    mockRequestAgeRange.mockResolvedValue({ lowerBound: null, upperBound: null })
    const { result, onVerified, onRejected } = setup()
    await act(() => result.current.verifyAge())
    expect(result.current.showDobPicker).toBe(true)
    expect(result.current.isVerifying).toBe(false)
    expect(onVerified).not.toHaveBeenCalled()
    expect(onRejected).not.toHaveBeenCalled()
  })

  it('shows DOB picker when requestAgeRangeAsync throws', async () => {
    mockIsEligible.mockResolvedValue(true)
    mockRequestAgeRange.mockRejectedValue(new Error('not signed in'))
    const { result, onVerified, onRejected } = setup()
    await act(() => result.current.verifyAge())
    expect(result.current.showDobPicker).toBe(true)
    expect(result.current.isVerifying).toBe(false)
    expect(onVerified).not.toHaveBeenCalled()
    expect(onRejected).not.toHaveBeenCalled()
  })

  it('falls through to requestAgeRangeAsync when isEligibleForAgeFeaturesAsync throws', async () => {
    mockIsEligible.mockRejectedValue(new Error('service error'))
    mockRequestAgeRange.mockResolvedValue({ lowerBound: 18, upperBound: null })
    const { result, onVerified } = setup()
    await act(() => result.current.verifyAge())
    // isEligible error treated as unknown — falls through to requestAgeRangeAsync
    expect(mockRequestAgeRange).toHaveBeenCalledTimes(1)
    expect(onVerified).toHaveBeenCalledTimes(1)
  })
})

describe('Android', () => {
  beforeEach(() => {
    __setJestPlatformOS('android')
    mockRequestSignalsAccess.mockResolvedValue('SHARED')
  })

  it('calls onVerified when lowerBound >= 18', async () => {
    mockRequestAgeRange.mockResolvedValue({ lowerBound: 18, upperBound: null })
    const { result, onVerified } = setup()
    await act(() => result.current.verifyAge())
    expect(onVerified).toHaveBeenCalledTimes(1)
    expect(mockIsEligible).not.toHaveBeenCalled()
    expect(result.current.isVerifying).toBe(false)
  })

  it('requests age signals access before requesting the age range', async () => {
    const calls: string[] = []
    mockRequestSignalsAccess.mockImplementation(async () => {
      calls.push('access')
      return 'SHARED'
    })
    mockRequestAgeRange.mockImplementation(async () => {
      calls.push('range')
      return { lowerBound: 18, upperBound: null }
    })
    const { result } = setup()
    await act(() => result.current.verifyAge())
    expect(calls).toEqual(['access', 'range'])
  })

  it.each(['NOT_SHARED', null])(
    'shows DOB picker without requesting the age range when access status is %p',
    async (status) => {
      mockRequestSignalsAccess.mockResolvedValue(status)
      const { result, onVerified, onRejected } = setup()
      await act(() => result.current.verifyAge())
      expect(result.current.showDobPicker).toBe(true)
      expect(result.current.isVerifying).toBe(false)
      expect(mockRequestAgeRange).not.toHaveBeenCalled()
      expect(onVerified).not.toHaveBeenCalled()
      expect(onRejected).not.toHaveBeenCalled()
    },
  )

  it('flags VERIFICATION_REQUIRED as needing Play Store resolution instead of offering the DOB picker', async () => {
    mockRequestSignalsAccess.mockResolvedValue('VERIFICATION_REQUIRED')
    const { result, onVerified, onRejected } = setup()
    await act(() => result.current.verifyAge())
    expect(result.current.needsPlayVerification).toBe(true)
    expect(result.current.showDobPicker).toBe(false)
    expect(result.current.isVerifying).toBe(false)
    expect(mockRequestAgeRange).not.toHaveBeenCalled()
    expect(onVerified).not.toHaveBeenCalled()
    expect(onRejected).not.toHaveBeenCalled()
  })

  it('retryPlayVerification clears the flag and re-runs the age check', async () => {
    mockRequestSignalsAccess
      .mockResolvedValueOnce('VERIFICATION_REQUIRED')
      .mockResolvedValueOnce('SHARED')
    mockRequestAgeRange.mockResolvedValue({ lowerBound: 21, upperBound: null })
    const { result, onVerified } = setup()
    await act(() => result.current.verifyAge())
    expect(result.current.needsPlayVerification).toBe(true)
    await act(() => result.current.retryPlayVerification())
    expect(result.current.needsPlayVerification).toBe(false)
    expect(mockRequestAgeRange).toHaveBeenCalledTimes(1)
    expect(onVerified).toHaveBeenCalledTimes(1)
  })

  it('keeps the Play gate on when retryPlayVerification is followed by a thrown requestAgeSignalsAccessAsync', async () => {
    mockRequestSignalsAccess
      .mockResolvedValueOnce('VERIFICATION_REQUIRED')
      .mockRejectedValueOnce(new Error('play services error'))
    mockRequestAgeRange.mockResolvedValue({ lowerBound: 18, upperBound: null })
    const { result, onVerified, onRejected } = setup()
    await act(() => result.current.verifyAge())
    expect(result.current.needsPlayVerification).toBe(true)
    await act(() => result.current.retryPlayVerification())
    // Gate must stay on, picker must NOT appear, range must NOT be called, and no
    // accept/reject callback may fire — Play verification never returned SHARED.
    expect(result.current.needsPlayVerification).toBe(true)
    expect(result.current.showDobPicker).toBe(false)
    expect(mockRequestAgeRange).not.toHaveBeenCalled()
    expect(onVerified).not.toHaveBeenCalled()
    expect(onRejected).not.toHaveBeenCalled()
  })

  it('keeps the Play gate on when retryPlayVerification returns NOT_SHARED', async () => {
    mockRequestSignalsAccess
      .mockResolvedValueOnce('VERIFICATION_REQUIRED')
      .mockResolvedValueOnce('NOT_SHARED')
    mockRequestAgeRange.mockResolvedValue({ lowerBound: 18, upperBound: null })
    const { result, onVerified, onRejected } = setup()
    await act(() => result.current.verifyAge())
    expect(result.current.needsPlayVerification).toBe(true)
    await act(() => result.current.retryPlayVerification())
    // Gate must stay on because Play has not confirmed SHARED this round.
    expect(result.current.needsPlayVerification).toBe(true)
    expect(result.current.showDobPicker).toBe(false)
    expect(mockRequestAgeRange).not.toHaveBeenCalled()
    expect(onVerified).not.toHaveBeenCalled()
    expect(onRejected).not.toHaveBeenCalled()
  })

  it('falls through to requestAgeRangeAsync when requestAgeSignalsAccessAsync throws', async () => {
    mockRequestSignalsAccess.mockRejectedValue(new Error('play services error'))
    mockRequestAgeRange.mockResolvedValue({ lowerBound: 18, upperBound: null })
    const { result, onVerified } = setup()
    await act(() => result.current.verifyAge())
    expect(mockRequestAgeRange).toHaveBeenCalledTimes(1)
    expect(onVerified).toHaveBeenCalledTimes(1)
  })

  it('calls onRejected when lowerBound < 18', async () => {
    mockRequestAgeRange.mockResolvedValue({ lowerBound: 17, upperBound: 17 })
    const { result, onRejected } = setup()
    await act(() => result.current.verifyAge())
    expect(onRejected).toHaveBeenCalledTimes(1)
    expect(result.current.isVerifying).toBe(false)
  })

  it('shows DOB picker when requestAgeRangeAsync throws', async () => {
    mockRequestAgeRange.mockRejectedValue(new Error('play services error'))
    const { result, onVerified, onRejected } = setup()
    await act(() => result.current.verifyAge())
    expect(result.current.showDobPicker).toBe(true)
    expect(result.current.isVerifying).toBe(false)
    expect(onVerified).not.toHaveBeenCalled()
    expect(onRejected).not.toHaveBeenCalled()
  })
})

describe('handleDobResult', () => {
  it('calls onVerified when isAdult is true', () => {
    const { result, onVerified } = setup()
    act(() => result.current.handleDobResult(true))
    expect(onVerified).toHaveBeenCalledTimes(1)
  })

  it('calls onRejected when isAdult is false', () => {
    const { result, onRejected } = setup()
    act(() => result.current.handleDobResult(false))
    expect(onRejected).toHaveBeenCalledTimes(1)
  })
})
