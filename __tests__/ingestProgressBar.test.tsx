import React from 'react'
import { act, create } from 'react-test-renderer'

// Mock react-native-paper useTheme
jest.mock('react-native-paper', () => ({
  useTheme: () => ({ colors: { primary: '#6200ee' } }),
}))

import IngestProgressBar from '~/components/composer/IngestProgressBar'

describe('IngestProgressBar', () => {
  it('renders null when progress is 0', () => {
    let tree!: ReturnType<typeof create>
    act(() => { tree = create(<IngestProgressBar progress={0} />) })
    expect(tree.toJSON()).toBeNull()
  })

  it('renders null when progress is negative', () => {
    let tree!: ReturnType<typeof create>
    act(() => { tree = create(<IngestProgressBar progress={-0.1} />) })
    expect(tree.toJSON()).toBeNull()
  })

  it('renders a bar when progress > 0', () => {
    let tree!: ReturnType<typeof create>
    act(() => { tree = create(<IngestProgressBar progress={0.5} />) })
    expect(tree.toJSON()).not.toBeNull()
  })

  it('clamps width to 100% at progress=1.5', () => {
    let tree!: ReturnType<typeof create>
    act(() => { tree = create(<IngestProgressBar progress={1.5} />) })
    const json = tree.toJSON() as any
    // The inner View (bar) should have width='100%'
    const bar = json.children[0]
    expect(bar.props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ width: '100%' }),
      ])
    )
  })
})
