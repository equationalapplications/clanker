import { renderHook, waitFor } from '@testing-library/react-native'
import { usePathname } from 'expo-router'
import { logScreenView, waitForAnalyticsInit } from '~/services/analyticsService'
import { useScreenTracking } from '../useScreenTracking'

jest.mock('expo-router', () => ({
  usePathname: jest.fn(),
}))

jest.mock('~/services/analyticsService', () => ({
  logScreenView: jest.fn(),
  waitForAnalyticsInit: jest.fn().mockResolvedValue(undefined),
}))

describe('useScreenTracking', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.mocked(waitForAnalyticsInit).mockResolvedValue(undefined)
  })

  it('logs a screen view for the initial pathname after analytics init', async () => {
    jest.mocked(usePathname).mockReturnValue('/characters')
    renderHook(() => useScreenTracking())
    await waitFor(() => {
      expect(waitForAnalyticsInit).toHaveBeenCalled()
      expect(logScreenView).toHaveBeenCalledWith('/characters')
    })
    expect(logScreenView).toHaveBeenCalledTimes(1)
  })

  it('logs a new screen view when the pathname changes', async () => {
    jest.mocked(usePathname).mockReturnValue('/characters')
    const { rerender } = renderHook(() => useScreenTracking())
    await waitFor(() => expect(logScreenView).toHaveBeenCalledWith('/characters'))

    jest.mocked(usePathname).mockReturnValue('/settings')
    rerender({})

    await waitFor(() => {
      expect(logScreenView).toHaveBeenCalledTimes(2)
      expect(logScreenView).toHaveBeenLastCalledWith('/settings')
    })
  })

  it('does not log again when the pathname is unchanged across renders', async () => {
    jest.mocked(usePathname).mockReturnValue('/characters')
    const { rerender } = renderHook(() => useScreenTracking())
    await waitFor(() => expect(logScreenView).toHaveBeenCalledTimes(1))
    rerender({})
    rerender({})
    expect(logScreenView).toHaveBeenCalledTimes(1)
  })
})
