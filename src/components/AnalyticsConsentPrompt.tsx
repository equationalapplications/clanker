import React, { useState } from 'react'
import { Platform, StyleSheet } from 'react-native'
import { Button, Dialog, Portal, Text } from 'react-native-paper'

import { useSettings } from '~/contexts/SettingsContext'
import { hasStoredSetting } from '~/utilities/settingsStorage'

type AnalyticsConsentPromptProps = {
  /** Show only once the user is past the Terms gate, so the two dialogs never stack. */
  enabled: boolean
}

/**
 * One-time native prompt asking whether to share usage analytics.
 *
 * Native analytics is opt-in (`setting:analytics`, off by default, and
 * `analytics_auto_collection_enabled: false` in firebase.json), and the only switch used to
 * live in Settings, so almost no installs ever reported to GA4. This asks once, after Terms,
 * while the choice is still unset. Either answer is persisted through `updateSetting`, so the
 * prompt never returns; `clearSettings()` on sign-out resets it for the next account.
 *
 * Web is excluded: there, the cookie-consent banner already owns this choice.
 */
export function AnalyticsConsentPrompt({ enabled }: AnalyticsConsentPromptProps) {
  const { updateSetting } = useSettings()
  const [visible, setVisible] = useState(
    () => Platform.OS !== 'web' && !hasStoredSetting('analytics'),
  )

  if (!enabled || !visible) {
    return null
  }

  const choose = (allow: boolean) => {
    updateSetting('analytics', allow)
    setVisible(false)
  }

  return (
    <Portal>
      <Dialog visible onDismiss={() => choose(false)} testID="analytics-consent-prompt">
        <Dialog.Title>Help improve Clanker?</Dialog.Title>
        <Dialog.Content>
          <Text variant="bodyMedium" style={styles.body}>
            Share usage data and crash reports, such as which screens you open and when something
            breaks. This never includes your chat content or advertising IDs. You can change this
            anytime in Settings.
          </Text>
        </Dialog.Content>
        <Dialog.Actions>
          <Button onPress={() => choose(false)} testID="analytics-consent-decline">
            No thanks
          </Button>
          <Button onPress={() => choose(true)} testID="analytics-consent-allow">
            Share
          </Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  )
}

const styles = StyleSheet.create({
  body: {
    lineHeight: 20,
  },
})
