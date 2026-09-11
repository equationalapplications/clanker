/**
 * Web half of the alert seam.
 *
 * react-native-web ships `Alert` as `static alert() {}` — a literal no-op — so
 * before this seam existed every alert on web failed silently: the user pressed
 * a button and nothing happened, with nothing logged to explain it. These cover
 * the mapping from the native action array onto window.confirm/alert.
 */
import { showAlert } from '../src/utilities/showAlert.web'

describe('showAlert (web)', () => {
  const originalConfirm = window.confirm
  const originalAlert = window.alert

  afterEach(() => {
    window.confirm = originalConfirm
    window.alert = originalAlert
    jest.clearAllMocks()
  })

  it('runs the confirm action when the user accepts', () => {
    window.confirm = jest.fn().mockReturnValue(true)
    const onConfirm = jest.fn()
    const onCancel = jest.fn()

    showAlert('Finishing Cloud Sync', 'Not synced yet.', [
      { text: 'Cancel', style: 'cancel', onPress: onCancel },
      { text: 'Retry Sync', onPress: onConfirm },
    ])

    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Finishing Cloud Sync'))
    expect(onConfirm).toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('runs the cancel action when the user declines', () => {
    window.confirm = jest.fn().mockReturnValue(false)
    const onConfirm = jest.fn()
    const onCancel = jest.fn()

    showAlert('Finishing Cloud Sync', 'Not synced yet.', [
      { text: 'Cancel', style: 'cancel', onPress: onCancel },
      { text: 'Retry Sync', onPress: onConfirm },
    ])

    expect(onConfirm).not.toHaveBeenCalled()
    expect(onCancel).toHaveBeenCalled()
  })

  it('degrades to a plain alert when there is nothing to confirm', () => {
    window.alert = jest.fn()
    window.confirm = jest.fn()

    showAlert('Heads up', 'Something happened.')

    expect(window.alert).toHaveBeenCalledWith('Heads up\n\nSomething happened.')
    expect(window.confirm).not.toHaveBeenCalled()
  })

  it('treats a cancel-only action list as nothing to confirm', () => {
    window.alert = jest.fn()
    window.confirm = jest.fn()

    showAlert('Heads up', 'Something happened.', [{ text: 'OK', style: 'cancel' }])

    expect(window.alert).toHaveBeenCalled()
    expect(window.confirm).not.toHaveBeenCalled()
  })

  it('runs the cancel callback for a cancel-only action list (native parity)', () => {
    // The native Alert.alert path invokes the cancel action's onPress when
    // the dialog is dismissed. The web twin was previously returning after
    // window.alert without firing the callback, so callers that close over
    // an "acknowledge" flag appeared to no-op on web — this regression
    // guards the symmetry.
    window.alert = jest.fn()
    window.confirm = jest.fn()
    const onCancel = jest.fn()

    showAlert('Heads up', 'Something happened.', [
      { text: 'Dismiss', style: 'cancel', onPress: onCancel },
    ])

    expect(window.alert).toHaveBeenCalled()
    expect(window.confirm).not.toHaveBeenCalled()
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
