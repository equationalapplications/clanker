import React from 'react'
import { render, fireEvent } from '@testing-library/react-native'
import { Linking } from 'react-native'
import { GroundingFooter } from '../GroundingFooter'
import type { GroundingMetadata } from '@google/genai'

// GroundingHtml wraps the snippet in a WebView (mocked to a View in jest.setup).
// For this test we only need to assert the prop is forwarded, so replace it with
// a plain Text rendering the snippet — same pattern as talkScreenGrounding.test.tsx.
// `jest.mock` factories are hoisted to the top of the file by babel-jest, so they
// may only reference hoisted variables (`require` is hoisted; ES imports are not).
// This is the same pattern every other test mock in the repo uses.
jest.mock('~/components/GroundingHtml', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- must be require(), see comment above
  const ReactLib = require('react')
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- must be require(), see comment above
  const { Text } = require('react-native')
  return {
    __esModule: true,
    // Plain passthrough: this test only exercises GroundingFooter's prop
    // forwarding. Sanitization lives in the real GroundingHtml + the
    // sanitizeGroundingHtmlForNative helper, both covered by their own tests.
    GroundingHtml: ({ html }: { html: string }) => ReactLib.createElement(Text, null, html),
  }
})

const baseMeta: GroundingMetadata = {
  groundingChunks: [
    { web: { uri: 'https://example.com', title: 'Example' } },
    { web: { uri: 'ftp://example.com', title: 'FTP' } },
  ],
}

describe('GroundingFooter', () => {
  it('renders a citation chip per safe chunk', () => {
    const { getByText, queryByText } = render(<GroundingFooter metadata={baseMeta} />)
    expect(getByText('Example')).toBeTruthy()
    expect(queryByText('FTP')).toBeNull()
  })

  it('opens a citation URL on chip press', () => {
    const openSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined)
    const { getByText } = render(<GroundingFooter metadata={baseMeta} />)
    fireEvent.press(getByText('Example'))
    expect(openSpy).toHaveBeenCalledWith('https://example.com')
    openSpy.mockRestore()
  })

  it('renders the search suggestions renderedContent when present', () => {
    const meta: GroundingMetadata = {
      searchEntryPoint: { renderedContent: '<b>suggestion</b>' },
    }
    const { getByText } = render(<GroundingFooter metadata={meta} />)
    expect(getByText('<b>suggestion</b>')).toBeTruthy()
  })

  it('returns null when there are no chunks and no renderedContent', () => {
    const { toJSON } = render(<GroundingFooter metadata={{} as GroundingMetadata} />)
    expect(toJSON()).toBeNull()
  })
})
