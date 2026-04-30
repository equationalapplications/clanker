import React from 'react'
import { create, act } from 'react-test-renderer'

jest.mock('react-native', () => {
  const React = require('react')
  return {
    Image: ({ accessibilityLabel, accessibilityRole, style, source, ...rest }: any) =>
      React.createElement('Image', { accessibilityLabel, accessibilityRole, style, source, ...rest }),
    StyleSheet: { create: (s: any) => s },
  }
})

import Logo from '~/components/Logo'

describe('Logo accessibility', () => {
  it('has accessibilityLabel "Clanker logo"', () => {
    let tree: any
    act(() => { tree = create(<Logo />) })
    const image = tree.root.findByType('Image')
    expect(image.props.accessibilityLabel).toBe('Clanker logo')
  })

  it('has accessibilityRole "image"', () => {
    let tree: any
    act(() => { tree = create(<Logo />) })
    const image = tree.root.findByType('Image')
    expect(image.props.accessibilityRole).toBe('image')
  })
})
