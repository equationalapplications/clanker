import { renderHook } from '@testing-library/react-native'
import { usePathname } from 'expo-router'
import { logScreenView } from '~/services/analyticsService'
import { useScreenTracking } from '../useScreenTracking'

jest.mock('expo-router', () => ({
  usePathname: jest.fn(),
}))

jest.mock('~/services/analyticsService', () => ({
  logScreenView: jest.fn(),
}))

describe('useScreenTracking', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('logs a screen view for the initial pathname', () => {
    jest.mocked(usePathname).mockReturnValue('/characters')
    renderHook(() => useScreenTracking())
    expect(logScreenView).toHaveBeenCalledWith('/characters')
    expect(logScreenView).toHaveBeenCalledTimes(1)
  })

  it('logs a new screen view when the pathname changes', () => {
    jest.mocked(usePathname).mockReturnValue('/characters')
    const { rerender } = renderHook(() => useScreenTracking())

    jest.mocked(usePathname).mockReturnValue('/settings')
    rerender({})

    expect(logScreenView).toHaveBeenCalledTimes(2)
    expect(logScreenView).toHaveBeenLastCalledWith('/settings')
  })

  it('does not log again when the pathname is unchanged across renders', () => {
    jest.mocked(usePathname).mockReturnValue('/characters')
    const { rerender } = renderHook(() => useScreenTracking())
    rerender({})
    rerender({})
    expect(logScreenView).toHaveBeenCalledTimes(1)
  })
})
