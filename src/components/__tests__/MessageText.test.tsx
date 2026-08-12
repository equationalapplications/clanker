import React from 'react'
import { render, fireEvent } from '@testing-library/react-native'
import { Linking } from 'react-native'
import { MessageText } from '../MessageText'

describe('MessageText', () => {
  it('renders plain text', () => {
    const { getByText } = render(<MessageText text="hello world" color="#000" />)
    expect(getByText('hello world')).toBeTruthy()
  })

  it('renders a URL as a tappable inner text', () => {
    const { getByText } = render(<MessageText text="see https://example.com" color="#000" />)
    const url = getByText('https://example.com')
    expect(url).toBeTruthy()
  })

  it('opens a URL on press only when isSafeHttpUrl allows it', () => {
    const openSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined)
    const { getByText } = render(<MessageText text="go https://example.com" color="#000" />)
    fireEvent.press(getByText('https://example.com'))
    expect(openSpy).toHaveBeenCalledWith('https://example.com')
    openSpy.mockRestore()
  })

  it('does not open a non-http URL', () => {
    const openSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined)
    // `linkifyUrls` should not match `ftp://`, and `isSafeHttpUrl` filters
    // anything non-http(s). The non-http segment renders as a plain Text
    // with no onPress. Render, locate that Text, fire a press, and assert
    // no URL was opened.
    const { getByText } = render(<MessageText text="see ftp://example.com" color="#000" />)
    fireEvent.press(getByText('see ftp://example.com'))
    expect(openSpy).not.toHaveBeenCalled()
    openSpy.mockRestore()
  })

  it('does not match emails', () => {
    // `linkifyUrls` only matches http(s) URLs, so an email renders as plain
    // text with no onPress. Press the rendered text and assert no URL was
    // opened.
    const openSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined)
    const { getByText } = render(<MessageText text="mail user@example.com" color="#000" />)
    fireEvent.press(getByText('mail user@example.com'))
    expect(openSpy).not.toHaveBeenCalled()
    openSpy.mockRestore()
  })

  it('marks every safe URL with accessibilityRole="link"', () => {
    // react-native-web does not infer a link role from onPress, so the
    // rendered Text must carry accessibilityRole="link" explicitly. A
    // regression that drops the prop would leave VoiceOver/TalkBack users
    // without the link affordance even though tapping still opens the URL.
    const { getAllByText } = render(
      <MessageText text="see https://a.example and https://b.example" color="#000" />,
    )
    const urls = getAllByText(/^https:\/\//)
    expect(urls.length).toBeGreaterThan(0)
    for (const url of urls) {
      expect(url.props.accessibilityRole).toBe('link')
    }
  })
})
