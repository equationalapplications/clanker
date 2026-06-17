import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react-native'
import { ManualDobPicker } from '../ManualDobPicker'

function fillDob(month: string, day: string, year: string) {
  fireEvent.changeText(screen.getByTestId('dob-month'), month)
  fireEvent.changeText(screen.getByTestId('dob-day'), day)
  fireEvent.changeText(screen.getByTestId('dob-year'), year)
}

describe('ManualDobPicker', () => {
  it('renders month, day, year inputs and a submit button', () => {
    render(<ManualDobPicker onComplete={jest.fn()} />)
    expect(screen.getByTestId('dob-month')).toBeTruthy()
    expect(screen.getByTestId('dob-day')).toBeTruthy()
    expect(screen.getByTestId('dob-year')).toBeTruthy()
    expect(screen.getByTestId('dob-submit')).toBeTruthy()
  })

  it('calls onComplete(true) for a user who is clearly 18+', () => {
    const onComplete = jest.fn()
    render(<ManualDobPicker onComplete={onComplete} />)
    fillDob('1', '1', '1990')
    fireEvent.press(screen.getByTestId('dob-submit'))
    expect(onComplete).toHaveBeenCalledWith(true)
  })

  it('calls onComplete(false) for a user who is clearly under 18', () => {
    const onComplete = jest.fn()
    // Use a fixed year that is always < 18 years ago
    const minorYear = String(new Date().getFullYear() - 10)
    render(<ManualDobPicker onComplete={onComplete} />)
    fillDob('6', '15', minorYear)
    fireEvent.press(screen.getByTestId('dob-submit'))
    expect(onComplete).toHaveBeenCalledWith(false)
  })

  it('calls onComplete(true) when user turns 18 exactly today', () => {
    const today = new Date()
    const onComplete = jest.fn()
    const birthYear = String(today.getFullYear() - 18)
    const birthMonth = String(today.getMonth() + 1) // getMonth() is 0-indexed
    const birthDay = String(today.getDate())
    render(<ManualDobPicker onComplete={onComplete} />)
    fillDob(birthMonth, birthDay, birthYear)
    fireEvent.press(screen.getByTestId('dob-submit'))
    expect(onComplete).toHaveBeenCalledWith(true)
  })

  it('calls onComplete(false) when birthday is tomorrow 18 years ago (not yet 18)', () => {
    const today = new Date()
    const onComplete = jest.fn()
    // tomorrow's date, 18 years ago → birthday not yet reached → still 17
    const futureDate = new Date(today.getFullYear() - 18, today.getMonth(), today.getDate() + 1)
    render(<ManualDobPicker onComplete={onComplete} />)
    fillDob(
      String(futureDate.getMonth() + 1),
      String(futureDate.getDate()),
      String(futureDate.getFullYear()),
    )
    fireEvent.press(screen.getByTestId('dob-submit'))
    expect(onComplete).toHaveBeenCalledWith(false)
  })

  it('does not call onComplete when fields are empty', () => {
    const onComplete = jest.fn()
    render(<ManualDobPicker onComplete={onComplete} />)
    fireEvent.press(screen.getByTestId('dob-submit'))
    expect(onComplete).not.toHaveBeenCalled()
  })

  it('does not call onComplete when loading', () => {
    const onComplete = jest.fn()
    render(<ManualDobPicker onComplete={onComplete} loading />)
    fillDob('1', '1', '1990')
    fireEvent.press(screen.getByTestId('dob-submit'))
    expect(onComplete).not.toHaveBeenCalled()
  })

  it('does not call onComplete for invalid dates', () => {
    const onComplete = jest.fn()
    render(<ManualDobPicker onComplete={onComplete} />)

    fillDob('-1', '15', '1990')
    fireEvent.press(screen.getByTestId('dob-submit'))
    expect(onComplete).not.toHaveBeenCalled()

    fillDob('2', '31', '1990')
    fireEvent.press(screen.getByTestId('dob-submit'))
    expect(onComplete).not.toHaveBeenCalled()

    const futureYear = String(new Date().getFullYear() + 1)
    fillDob('1', '1', futureYear)
    fireEvent.press(screen.getByTestId('dob-submit'))
    expect(onComplete).not.toHaveBeenCalled()
  })
})
