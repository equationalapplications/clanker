import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react-native'
import { ManualDobPicker } from '../ManualDobPicker'

async function fillDob(month: string, day: string, year: string) {
  await act(async () => {
    fireEvent.changeText(screen.getByTestId('dob-month'), month)
    fireEvent.changeText(screen.getByTestId('dob-day'), day)
    fireEvent.changeText(screen.getByTestId('dob-year'), year)
  })
}

describe('ManualDobPicker', () => {
  it('renders month, day, year inputs and a submit button', async () => {
    await render(<ManualDobPicker onComplete={jest.fn()} />)
    expect(screen.getByTestId('dob-month')).toBeTruthy()
    expect(screen.getByTestId('dob-day')).toBeTruthy()
    expect(screen.getByTestId('dob-year')).toBeTruthy()
    expect(screen.getByTestId('dob-submit')).toBeTruthy()
  })

  it('calls onComplete(true) for a user who is clearly 18+', async () => {
    const onComplete = jest.fn()
    await render(<ManualDobPicker onComplete={onComplete} />)
    await fillDob('1', '1', '1990')
    await act(async () => {
      fireEvent.press(screen.getByTestId('dob-submit'))
    })
    expect(onComplete).toHaveBeenCalledWith(true)
  })

  it('calls onComplete(false) for a user who is clearly under 18', async () => {
    const onComplete = jest.fn()
    // Use a fixed year that is always < 18 years ago
    const minorYear = String(new Date().getFullYear() - 10)
    await render(<ManualDobPicker onComplete={onComplete} />)
    await fillDob('6', '15', minorYear)
    await act(async () => {
      fireEvent.press(screen.getByTestId('dob-submit'))
    })
    expect(onComplete).toHaveBeenCalledWith(false)
  })

  it('calls onComplete(true) when user turns 18 exactly today', async () => {
    const today = new Date()
    const onComplete = jest.fn()
    const birthYear = String(today.getFullYear() - 18)
    const birthMonth = String(today.getMonth() + 1) // getMonth() is 0-indexed
    const birthDay = String(today.getDate())
    await render(<ManualDobPicker onComplete={onComplete} />)
    await fillDob(birthMonth, birthDay, birthYear)
    await act(async () => {
      fireEvent.press(screen.getByTestId('dob-submit'))
    })
    expect(onComplete).toHaveBeenCalledWith(true)
  })

  it('calls onComplete(false) when birthday is tomorrow 18 years ago (not yet 18)', async () => {
    const today = new Date()
    const onComplete = jest.fn()
    // tomorrow's date, 18 years ago → birthday not yet reached → still 17
    const futureDate = new Date(today.getFullYear() - 18, today.getMonth(), today.getDate() + 1)
    await render(<ManualDobPicker onComplete={onComplete} />)
    await fillDob(
      String(futureDate.getMonth() + 1),
      String(futureDate.getDate()),
      String(futureDate.getFullYear()),
    )
    await act(async () => {
      fireEvent.press(screen.getByTestId('dob-submit'))
    })
    expect(onComplete).toHaveBeenCalledWith(false)
  })

  it('does not call onComplete when fields are empty', async () => {
    const onComplete = jest.fn()
    await render(<ManualDobPicker onComplete={onComplete} />)
    await act(async () => {
      fireEvent.press(screen.getByTestId('dob-submit'))
    })
    expect(onComplete).not.toHaveBeenCalled()
  })

  it('does not call onComplete when loading', async () => {
    const onComplete = jest.fn()
    await render(<ManualDobPicker onComplete={onComplete} loading />)
    await fillDob('1', '1', '1990')
    await act(async () => {
      fireEvent.press(screen.getByTestId('dob-submit'))
    })
    expect(onComplete).not.toHaveBeenCalled()
  })

  it('does not call onComplete for invalid dates', async () => {
    const onComplete = jest.fn()
    await render(<ManualDobPicker onComplete={onComplete} />)

    await fillDob('-1', '15', '1990')
    await act(async () => {
      fireEvent.press(screen.getByTestId('dob-submit'))
    })
    expect(onComplete).not.toHaveBeenCalled()

    await fillDob('2', '31', '1990')
    await act(async () => {
      fireEvent.press(screen.getByTestId('dob-submit'))
    })
    expect(onComplete).not.toHaveBeenCalled()

    await fillDob('1', '1', '199a')
    await act(async () => {
      fireEvent.press(screen.getByTestId('dob-submit'))
    })
    expect(onComplete).not.toHaveBeenCalled()

    const futureYear = String(new Date().getFullYear() + 1)
    await fillDob('1', '1', futureYear)
    await act(async () => {
      fireEvent.press(screen.getByTestId('dob-submit'))
    })
    expect(onComplete).not.toHaveBeenCalled()
  })
})
