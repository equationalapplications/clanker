/**
 * @jest-environment jsdom
 */
import React from 'react'
import { create, act } from 'react-test-renderer'

// Mock Platform as web
jest.mock('react-native', () => {
  const React = require('react')
  return {
    StyleSheet: { create: (s: any) => s },
    ScrollView: ({ children, style, contentContainerStyle, showsVerticalScrollIndicator }: any) =>
      React.createElement('ScrollView', { style, contentContainerStyle }, children),
    View: ({ children, style, nativeID, tabIndex }: any) =>
      React.createElement('View', { style, nativeID, tabIndex }, children),
    Platform: { OS: 'web' },
  }
})

jest.mock('react-native-paper', () => ({
  useTheme: () => ({ colors: { background: '#fff' } }),
}))

jest.mock('~/components/LandingPage/HeroSection', () => () => null)
jest.mock('~/components/LandingPage/FeaturesSection', () => () => null)
jest.mock('~/components/LandingPage/ComingSoonSection', () => () => null)
jest.mock('~/components/LandingPage/LandingFooter', () => () => null)

import LandingPage from '~/components/LandingPage'

const MAIN_CONTENT_ID = 'main-content'

describe('LandingPage skip link (web)', () => {
  it('renders a skip link <a> element with href="#main-content"', () => {
    let tree: any
    act(() => { tree = create(<LandingPage />) })

    const skipLinks = tree.root.findAll(
      (node: any) => node.type === 'a' && node.props.href === `#${MAIN_CONTENT_ID}`,
    )
    expect(skipLinks.length).toBe(1)
    expect(skipLinks[0].props.href).toBe(`#${MAIN_CONTENT_ID}`)
  })

  it('skip link text is "Skip to main content"', () => {
    let tree: any
    act(() => { tree = create(<LandingPage />) })

    const skipLinks = tree.root.findAll(
      (node: any) => node.type === 'a' && node.props.href === `#${MAIN_CONTENT_ID}`,
    )
    expect(skipLinks.length).toBe(1)
    expect(skipLinks[0].props.children).toBe('Skip to main content')
  })

  it('main content area has nativeID="main-content"', () => {
    let tree: any
    act(() => { tree = create(<LandingPage />) })

    const mainContent = tree.root.findAll((node: any) => node.props.nativeID === MAIN_CONTENT_ID)
    expect(mainContent.length).toBeGreaterThan(0)
  })

  it('onClick prevents default and focuses the main content element', () => {
    let tree: any
    act(() => { tree = create(<LandingPage />) })

    const mockFocus = jest.fn()
    const mockGetElementById = jest
      .spyOn(document, 'getElementById')
      .mockReturnValue({ focus: mockFocus } as unknown as HTMLElement)

    try {
      const skipLink = tree.root.find(
        (node: any) => node.type === 'a' && node.props.href === `#${MAIN_CONTENT_ID}`,
      )

      const mockEvent = { preventDefault: jest.fn() }
      act(() => { skipLink.props.onClick(mockEvent) })

      expect(mockGetElementById).toHaveBeenCalledWith(MAIN_CONTENT_ID)
      expect(mockEvent.preventDefault).toHaveBeenCalled()
      expect(mockFocus).toHaveBeenCalled()
    } finally {
      mockGetElementById.mockRestore()
    }
  })
})
