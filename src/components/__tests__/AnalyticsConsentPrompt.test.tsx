import React from 'react'
import { Platform } from 'react-native'
import { render as rtlRender, screen, fireEvent, act } from '@testing-library/react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { AnalyticsConsentPrompt } from '../AnalyticsConsentPrompt'

const mockUpdateSetting = jest.fn()
const mockHasStoredSetting = jest.fn()

jest.mock('~/contexts/SettingsContext', () => ({
  useSettings: () => ({ settings: {}, updateSetting: mockUpdateSetting }),
}))

jest.mock('~/utilities/settingsStorage', () => ({
  hasStoredSetting: (...args: unknown[]) => mockHasStoredSetting(...args),
}))

jest.mock('react-native-paper', () => {
  const actual = jest.requireActual('react-native-paper')
  const ReactActual = jest.requireActual('react')
  return {
    ...actual,
    Portal: ({ children }: { children: React.ReactNode }) =>
      ReactActual.createElement(ReactActual.Fragment, null, children),
  }
})

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
}

// Paper's Dialog reads safe-area insets.
const render = (ui: React.ReactElement) =>
  rtlRender(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>)

const originalOS = Platform.OS

function setOS(os: typeof Platform.OS) {
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os })
}

describe('AnalyticsConsentPrompt', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    setOS('ios')
    mockHasStoredSetting.mockReturnValue(false)
  })

  afterAll(() => setOS(originalOS))

  it('asks once on native when the analytics choice is unset', async () => {
    await render(<AnalyticsConsentPrompt enabled />)
    expect(mockHasStoredSetting).toHaveBeenCalledWith('analytics')
    expect(screen.getByTestId('analytics-consent-prompt')).toBeTruthy()
  })

  it('persists "Share" as analytics on and closes', async () => {
    await render(<AnalyticsConsentPrompt enabled />)
    await act(async () => {
      fireEvent.press(screen.getByTestId('analytics-consent-allow'))
    })
    expect(mockUpdateSetting).toHaveBeenCalledWith('analytics', true)
    expect(screen.queryByTestId('analytics-consent-prompt')).toBeNull()
  })

  it('persists "No thanks" as analytics off and closes', async () => {
    await render(<AnalyticsConsentPrompt enabled />)
    await act(async () => {
      fireEvent.press(screen.getByTestId('analytics-consent-decline'))
    })
    expect(mockUpdateSetting).toHaveBeenCalledWith('analytics', false)
    expect(screen.queryByTestId('analytics-consent-prompt')).toBeNull()
  })

  it('stays hidden once a choice is stored', async () => {
    mockHasStoredSetting.mockReturnValue(true)
    await render(<AnalyticsConsentPrompt enabled />)
    expect(screen.queryByTestId('analytics-consent-prompt')).toBeNull()
  })

  it('stays hidden until the Terms gate is passed', async () => {
    await render(<AnalyticsConsentPrompt enabled={false} />)
    expect(screen.queryByTestId('analytics-consent-prompt')).toBeNull()
  })

  it('never shows on web, where cookie consent owns the choice', async () => {
    setOS('web')
    await render(<AnalyticsConsentPrompt enabled />)
    expect(screen.queryByTestId('analytics-consent-prompt')).toBeNull()
  })
})
