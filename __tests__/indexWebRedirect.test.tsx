import React from 'react'
import { act, create } from 'react-test-renderer'

const mockUseSelector = jest.fn()
const mockUseAuthMachine = jest.fn(() => ({}))

jest.mock('@xstate/react', () => ({
  useSelector: (...args: unknown[]) => mockUseSelector(...args),
}))

jest.mock('~/hooks/useMachines', () => ({
  useAuthMachine: () => mockUseAuthMachine(),
}))

jest.mock('~/components/LandingPage', () => {
  const React = require('react')
  return () => React.createElement('LandingPage', {})
})

jest.mock('~/components/LoadingIndicator', () => {
  const React = require('react')
  return () => React.createElement('LoadingIndicator', {})
})

jest.mock('expo-router/head', () => {
  const React = require('react')
  return ({ children }: { children: React.ReactNode }) => React.createElement('Head', {}, children)
})

jest.mock('expo-router', () => {
  const React = require('react')
  return {
    Redirect: ({ href }: { href: string }) => React.createElement('Redirect', { href }),
  }
})

import WebIndex from '../app/index.web'

describe('WebIndex root behavior', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('redirects signed-in users to /chat on web root', () => {
    mockUseSelector.mockImplementationOnce(() => ({ uid: 'u1' }))
    mockUseSelector.mockImplementationOnce(() => false)

    let tree: any
    act(() => {
      tree = create(<WebIndex />)
    })
    const redirects = tree.root.findAllByType('Redirect')

    expect(redirects).toHaveLength(1)
    expect(redirects[0]?.props.href).toBe('/chat')
  })

  it('renders landing page for signed-out users', () => {
    mockUseSelector.mockImplementationOnce(() => null)
    mockUseSelector.mockImplementationOnce(() => false)

    let tree: any
    act(() => {
      tree = create(<WebIndex />)
    })

    expect(tree.root.findAllByType('LandingPage')).toHaveLength(1)
    expect(tree.root.findAllByType('Redirect')).toHaveLength(0)
  })
})
