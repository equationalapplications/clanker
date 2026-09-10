import { Alert } from 'react-native'

export interface AlertAction {
  text: string
  onPress?: () => void
  style?: 'default' | 'cancel' | 'destructive'
}

/**
 * Cross-platform alert.
 *
 * react-native-web ships `Alert` as a literal no-op (`static alert() {}`), so
 * every `Alert.alert` call on web fails silently — the user presses a button and
 * nothing happens, with no error to explain it. This seam keeps the native
 * behaviour and gives web a real prompt; see showAlert.web.ts.
 */
export function showAlert(title: string, message: string, actions?: AlertAction[]): void {
  Alert.alert(title, message, actions)
}
