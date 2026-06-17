import { renderHook, act } from '@testing-library/react-native'
import { Platform } from 'react-native'
import * as AgeRange from 'expo-age-range'
import { useAgeVerification } from '../useAgeVerification'

jest.mock('expo-age-range', () => ({
  requestAgeRangeAsync: jest.fn(),
  isEligibleForAgeFeaturesAsync: jest.fn(),
}))

const mockRequestAgeRange = AgeRange.requestAgeRangeAsync as jest.Mock
const mockIsEligible = AgeRange.isEligibleForAgeFeaturesAsync as jest.Mock

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

  it('calls onVerified when isEligible is false (unregulated region)', async () => {
    mockIsEligible.mockResolvedValue(false)
    const { result, onVerified } = setup()
    await act(() => result.current.verifyAge())
    expect(onVerified).toHaveBeenCalledTimes(1)
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
  beforeEach(() => __setJestPlatformOS('android'))

  it('calls onVerified when lowerBound >= 18', async () => {
    mockRequestAgeRange.mockResolvedValue({ lowerBound: 18, upperBound: null })
    const { result, onVerified } = setup()
    await act(() => result.current.verifyAge())
    expect(onVerified).toHaveBeenCalledTimes(1)
    expect(mockIsEligible).not.toHaveBeenCalled()
    expect(result.current.isVerifying).toBe(false)
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
