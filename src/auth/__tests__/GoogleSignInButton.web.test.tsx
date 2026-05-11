/** @jest-environment jsdom */

import React from 'react'
import { render, screen, act, waitFor } from '@testing-library/react-native'
import GoogleSignInButton from '../GoogleSignInButton.web'
import * as googleSigninWeb from '../googleSignin.web'

jest.mock('../googleSignin.web', () => ({
  initializeGoogleSignIn: jest.fn().mockResolvedValue(undefined),
  renderGoogleSignInButton: jest.fn(),
  resetGoogleSignInWebForTests: jest.fn(),
}))

jest.mock('react-native-paper', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text, TouchableOpacity } = require('react-native')
  const Button = ({ children, disabled, onPress }: { children: React.ReactNode; disabled?: boolean; onPress?: () => void }) => (
    <TouchableOpacity onPress={onPress} disabled={disabled} testID="provider-button">
      <Text>{children}</Text>
    </TouchableOpacity>
  )
  return { Button }
})
jest.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }))

describe('GoogleSignInButton (web)', () => {
  let capturedHandlers: Parameters<typeof googleSigninWeb.initializeGoogleSignIn>[0] | null = null

  beforeEach(() => {
    jest.clearAllMocks()
    capturedHandlers = null
    ;(googleSigninWeb.initializeGoogleSignIn as jest.Mock).mockImplementation(async (handlers) => {
      capturedHandlers = handlers
    })
  })

  it('calls initializeGoogleSignIn then renderGoogleSignInButton on mount', async () => {
    render(<GoogleSignInButton />)
    await waitFor(() => {
      expect(googleSigninWeb.initializeGoogleSignIn).toHaveBeenCalledTimes(1)
      expect(googleSigninWeb.renderGoogleSignInButton).toHaveBeenCalledTimes(1)
    })
  })

  it('calls onLoadingChange(true) when onCredentialStart fires', async () => {
    const onLoadingChange = jest.fn()
    render(<GoogleSignInButton onLoadingChange={onLoadingChange} />)
    await waitFor(() => expect(capturedHandlers).not.toBeNull())
    act(() => capturedHandlers!.onCredentialStart())
    expect(onLoadingChange).toHaveBeenCalledWith(true)
  })

  it('calls onLoadingChange(false) when onCredentialSuccess fires', async () => {
    const onLoadingChange = jest.fn()
    render(<GoogleSignInButton onLoadingChange={onLoadingChange} />)
    await waitFor(() => expect(capturedHandlers).not.toBeNull())
    act(() => capturedHandlers!.onCredentialStart())
    act(() => capturedHandlers!.onCredentialSuccess())
    expect(onLoadingChange).toHaveBeenLastCalledWith(false)
  })

  it('calls onLoadingChange(false) and shows error caption when onCredentialError fires', async () => {
    const onLoadingChange = jest.fn()
    render(<GoogleSignInButton onLoadingChange={onLoadingChange} />)
    await waitFor(() => expect(capturedHandlers).not.toBeNull())
    act(() => capturedHandlers!.onCredentialError(new Error('auth/network-error')))
    expect(onLoadingChange).toHaveBeenLastCalledWith(false)
    expect(screen.getByText(/Sign-in failed/)).toBeTruthy()
  })

  it('renders a disabled fallback ProviderButton with caption when init rejects', async () => {
    ;(googleSigninWeb.initializeGoogleSignIn as jest.Mock).mockRejectedValueOnce(
      new Error('script load failed'),
    )
    render(<GoogleSignInButton />)
    await waitFor(() => {
      expect(screen.getByText(/Google Sign-In unavailable/)).toBeTruthy()
    })
  })
})
