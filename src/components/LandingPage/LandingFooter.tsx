import { View, StyleSheet, Pressable, Linking, Platform } from 'react-native'
import { Text, useTheme } from 'react-native-paper'
import { Link } from 'expo-router'
import { useCookieConsent } from '~/components/CookieConsent'

export default function LandingFooter() {
  const { colors } = useTheme()
  const { openPreferences } = useCookieConsent()

  return (
    <View style={styles.footer}>
      <Link href="/terms" asChild>
        <Text
          variant="bodySmall"
          style={[styles.link, { color: colors.outline }]}
        >
          Terms and Conditions
        </Text>
      </Link>
      <Text variant="bodySmall" style={{ color: colors.outline }}> · </Text>
      <Link href="/privacy" asChild>
        <Text
          variant="bodySmall"
          style={[styles.link, { color: colors.outline }]}
        >
          Privacy Policy
        </Text>
      </Link>
      <Text variant="bodySmall" style={{ color: colors.outline }}> · </Text>
      <Pressable
        accessibilityRole="link"
        onPress={() => {
          void Linking.openURL('https://equationalapplications.com/').catch((error) => {
            console.warn('Failed to open Equational Applications website', error)
          })
        }}
      >
        <Text variant="bodySmall" style={[styles.link, { color: colors.outline }]}>
          Equational Applications LLC
        </Text>
      </Pressable>
      {Platform.OS === 'web' && (
        <>
          <Text variant="bodySmall" style={{ color: colors.outline }}> · </Text>
          <Pressable accessibilityRole="link" onPress={openPreferences}>
            <Text variant="bodySmall" style={[styles.link, { color: colors.outline }]}>
              Cookie Preferences
            </Text>
          </Pressable>
        </>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  footer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 24,
    paddingHorizontal: 16,
    gap: 4,
  },
  link: {
    textDecorationLine: 'underline',
  },
})
