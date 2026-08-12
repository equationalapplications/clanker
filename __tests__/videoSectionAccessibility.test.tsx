import React from 'react'
import { create, act } from 'react-test-renderer'

jest.mock('react-native', () => {
  const React = require('react')
  return {
    Platform: { OS: 'ios', select: (spec: any) => spec.ios ?? spec.default },
    StyleSheet: { create: (s: any) => s },
    View: ({ children, style, ...props }: any) =>
      React.createElement('View', { style, ...props }, children),
  }
})

jest.mock('react-native-paper', () => {
  const React = require('react')
  return {
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    useTheme: () => ({
      colors: { onSurface: '#000' },
    }),
  }
})

import VideoSection from '~/components/LandingPage/VideoSection'
import { VIDEO } from '~/config/landingConfig'

describe('VideoSection accessibility', () => {
  it('renders a YouTube iframe with title and embed URL from config', () => {
    let tree: any
    act(() => {
      tree = create(<VideoSection />)
    })

    const iframe = tree.root.findByType('iframe')
    expect(iframe.props.title).toBe(VIDEO.iframeTitle)
    expect(iframe.props['aria-label']).toBe(VIDEO.iframeTitle)
    expect(iframe.props.src).toBe(`https://www.youtube.com/embed/${VIDEO.youtubeId}`)
    expect(iframe.props.sandbox).toBe(VIDEO.iframeSandbox)
  })

  it('renders the section heading from config', () => {
    let tree: any
    act(() => {
      tree = create(<VideoSection />)
    })

    const heading = tree.root.find(
      (node: any) =>
        node.props.accessibilityRole === 'header' && node.props.children === VIDEO.heading,
    )
    expect(heading).toBeTruthy()
  })
})
