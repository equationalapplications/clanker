import React, { useState, useEffect } from 'react'
import { Modal, Platform, Pressable, StyleSheet, View } from 'react-native'
import { Switch, Text, useTheme } from 'react-native-paper'
import { useCookieConsent } from './CookieConsentContext'
import { CookieCategory, COOKIE_CATEGORIES } from '~/utilities/cookieConsentTypes'

const LABELS: Record<CookieCategory, { title: string; description: string }> = {
  necessary: {
    title: 'Strictly necessary',
    description: 'Required for sign-in, security, and core app functionality. Always on.',
  },
  preferences: {
    title: 'Preferences',
    description: 'Remembers UI choices like theme.',
  },
  analytics: {
    title: 'Analytics',
    description: 'Helps us understand how Clanker is used so we can improve it.',
  },
  marketing: {
    title: 'Marketing',
    description: 'Used to measure campaigns. Currently unused; reserved for future opt-in.',
  },
}

export default function CookiePreferencesModal() {
  const { isPreferencesOpen, closePreferences, savePreferences, choices } = useCookieConsent()
  const { colors } = useTheme()
  const [draft, setDraft] = useState(choices)

  useEffect(() => {
    if (isPreferencesOpen) setDraft(choices)
  }, [isPreferencesOpen, choices])

  if (Platform.OS !== 'web') return null
  if (!isPreferencesOpen) return null

  return (
    <Modal transparent visible animationType="fade" onRequestClose={closePreferences}>
      <View style={styles.backdrop}>
        <View
          testID="cookie-preferences-modal"
          style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.outline }]}
        >
          <Text variant="titleMedium" style={{ color: colors.onSurface, marginBottom: 12 }}>
            Cookie preferences
          </Text>

          {COOKIE_CATEGORIES.map((cat) => (
            <View key={cat} style={styles.row}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={{ color: colors.onSurface }}>{LABELS[cat].title}</Text>
                <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
                  {LABELS[cat].description}
                </Text>
              </View>
              <Switch
                value={cat === 'necessary' ? true : draft[cat]}
                disabled={cat === 'necessary'}
                onValueChange={(v) => setDraft((d) => ({ ...d, [cat]: v }))}
                accessibilityLabel={`Toggle ${LABELS[cat].title}`}
              />
            </View>
          ))}

          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel cookie preferences"
              onPress={closePreferences}
              style={[styles.btn, { borderColor: colors.outline }]}
            >
              <Text style={{ color: colors.onSurface }}>Cancel</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Save cookie preferences"
              onPress={() => savePreferences(draft)}
              style={[styles.btnPrimary, { backgroundColor: colors.primary }]}
            >
              <Text style={{ color: colors.onPrimary }}>Save</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  card: { width: '100%', maxWidth: 480, borderRadius: 12, borderWidth: 1, padding: 20 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  actions: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end', marginTop: 16 },
  btn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1 },
  btnPrimary: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
})
