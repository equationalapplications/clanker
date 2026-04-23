import { View, StyleSheet, Pressable, Linking } from 'react-native'
import { Text, useTheme } from 'react-native-paper'
import { Link } from 'expo-router'

export default function LandingFooter() {
  const { colors } = useTheme()

  return (
    <View style={styles.footer}>
      <Link href="/terms" style={[styles.link, { color: colors.outline }]}>
        Terms and Conditions
      </Link>
      <Text variant="bodySmall" style={{ color: colors.outline }}> · </Text>
      <Link href="/privacy" style={[styles.link, { color: colors.outline }]}>
        Privacy Policy
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
