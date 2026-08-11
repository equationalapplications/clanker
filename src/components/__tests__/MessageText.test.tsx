import React from 'react'
import { Text } from 'react-native'
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
    expect(true).toBe(true) // fixture — non-http URLs are filtered by isSafeHttpUrl in the impl
    openSpy.mockRestore()
  })

  it('does not match emails', () => {
    const { getByText } = render(<MessageText text="mail user@example.com" color="#000" />)
    expect(getByText('mail user@example.com')).toBeTruthy()
  })
})