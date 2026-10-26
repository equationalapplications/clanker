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

jest.mock('~/components/LoadingIndicator', () => {
  const React = require('react')
  return () => React.createElement('LoadingIndicator', {})
})

jest.mock('expo-router', () => {
  const React = require('react')
  return {
    Redirect: ({ href }: { href: string }) => React.createElement('Redirect', { href }),
  }
})

import Index from '../app/index'

/**
 * app/index.tsx is the only root route on every platform. On the web it is
 * reached by in-app navigation only (router.replace('/') after checkout,
 * terms, admin): a full page load of `/` is served the static landing page by
 * Firebase Hosting, never this component.
 */
describe('Index root behavior', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('redirects signed-in users to /chat', () => {
    mockUseSelector.mockImplementationOnce(() => ({ uid: 'u1' }))
    mockUseSelector.mockImplementationOnce(() => false)

    let tree: any
    act(() => {
      tree = create(<Index />)
    })
    const redirects = tree.root.findAllByType('Redirect')
    expect(redirects).toHaveLength(1)
    expect(redirects[0]?.props.href).toBe('/chat')
  })

  it('redirects signed-out users to /sign-in', () => {
    mockUseSelector.mockImplementationOnce(() => null)
    mockUseSelector.mockImplementationOnce(() => false)

    let tree: any
    act(() => {
      tree = create(<Index />)
    })
    const redirects = tree.root.findAllByType('Redirect')
    expect(redirects).toHaveLength(1)
    expect(redirects[0]?.props.href).toBe('/sign-in')
  })

  it('shows the loading indicator while auth is resolving', () => {
    mockUseSelector.mockImplementationOnce(() => null)
    mockUseSelector.mockImplementationOnce(() => true)

    let tree: any
    act(() => {
      tree = create(<Index />)
    })
    expect(tree.root.findAllByType('LoadingIndicator')).toHaveLength(1)
    expect(tree.root.findAllByType('Redirect')).toHaveLength(0)
  })
})
