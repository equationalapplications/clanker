/** @jest-environment jsdom */

import React from 'react'
import { render, screen, waitFor } from '@testing-library/react-native'
import AppleSignInButton from '../AppleSignInButton.web'
import * as appleSigninWeb from '../appleSignin.web'

jest.mock('../appleSignin.web', () => ({
  initializeAppleSignIn: jest.fn().mockResolvedValue(() => {}),
}))

describe('AppleSignInButton (web)', () => {
  const originalClientId = process.env.EXPO_PUBLIC_APPLE_WEB_CLIENT_ID
  const originalRedirectUri = process.env.EXPO_PUBLIC_APPLE_WEB_REDIRECT_URI

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.EXPO_PUBLIC_APPLE_WEB_CLIENT_ID = 'com.example.app.web'
    process.env.EXPO_PUBLIC_APPLE_WEB_REDIRECT_URI = 'https://example.com/auth/apple'
  })

  afterEach(() => {
    if (originalClientId === undefined) {
      delete process.env.EXPO_PUBLIC_APPLE_WEB_CLIENT_ID
    } else {
      process.env.EXPO_PUBLIC_APPLE_WEB_CLIENT_ID = originalClientId
    }
    if (originalRedirectUri === undefined) {
      delete process.env.EXPO_PUBLIC_APPLE_WEB_REDIRECT_URI
    } else {
      process.env.EXPO_PUBLIC_APPLE_WEB_REDIRECT_URI = originalRedirectUri
    }
  })

  it('renders an unavailable fallback when Apple sign-in initialization fails', async () => {
    ;(appleSigninWeb.initializeAppleSignIn as jest.Mock).mockRejectedValueOnce(
      new Error('script init failed'),
    )

    render(<AppleSignInButton />)

    await waitFor(() => {
      expect(screen.getByTestId('apple-signin-unavailable-caption')).toBeTruthy()
      expect(screen.getByText(/Apple sign-in is unavailable right now/)).toBeTruthy()
    })
  })
})
