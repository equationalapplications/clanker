import React from 'react'
import { Platform, Pressable, StyleSheet, View } from 'react-native'
import { Text, useTheme } from 'react-native-paper'
import { Link } from 'expo-router'
import { useCookieConsent } from './CookieConsentContext'

export default function CookieConsentBanner() {
  const { isBannerVisible, acceptAll, rejectAll, openPreferences } = useCookieConsent()
  const { colors } = useTheme()

  if (Platform.OS !== 'web') return null
  if (!isBannerVisible) return null

  return (
    <View
      accessibilityRole="dialog"
      accessibilityLabel="Cookie consent"
      style={[styles.container, { backgroundColor: colors.elevation.level3, borderColor: colors.outline }]}
    >
      <Text variant="titleSmall" style={{ color: colors.onSurface, marginBottom: 8 }}>
        Cookies on Clanker
      </Text>
      <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant, marginBottom: 12 }}>
        We use cookies necessary to run the app. With your consent we may also use cookies for
        analytics, preferences, and marketing. You can change your choice anytime in Cookie
        Preferences.{' '}
        <Link href="/privacy">
          <Text style={[styles.link, { color: colors.primary }]}>Privacy policy</Text>
        </Link>
        .
      </Text>
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Reject all cookies"
          style={[styles.btn, { borderColor: colors.outline }]}
          onPress={rejectAll}
        >
          <Text style={{ color: colors.onSurface }}>Reject all</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Manage cookie preferences"
          style={[styles.btn, { borderColor: colors.outline }]}
          onPress={openPreferences}
        >
          <Text style={{ color: colors.onSurface }}>Manage preferences</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Accept all cookies"
          style={[styles.btnPrimary, { backgroundColor: colors.primary }]}
          onPress={acceptAll}
        >
          <Text style={{ color: colors.onPrimary }}>Accept all</Text>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    right: 16,
    bottom: 16,
    maxWidth: 380,
    width: '92%',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    zIndex: 1000,
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end' },
  btn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1 },
  btnPrimary: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  link: { textDecorationLine: 'underline' },
})
