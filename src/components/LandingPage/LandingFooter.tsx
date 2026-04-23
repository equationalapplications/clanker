import { View, StyleSheet, Pressable, Linking } from 'react-native'
import { Text, useTheme } from 'react-native-paper'
import { useRouter } from 'expo-router'

export default function LandingFooter() {
  const { colors } = useTheme()
  const router = useRouter()

  return (
    <View style={styles.footer}>
      <Pressable onPress={() => router.push('/terms')}>
        <Text variant="bodySmall" style={[styles.link, { color: colors.outline }]}>
          Terms and Conditions
        </Text>
      </Pressable>
      <Text variant="bodySmall" style={{ color: colors.outline }}> · </Text>
      <Pressable onPress={() => router.push('/privacy')}>
        <Text variant="bodySmall" style={[styles.link, { color: colors.outline }]}>
          Privacy Policy
        </Text>
      </Pressable>
      <Text variant="bodySmall" style={{ color: colors.outline }}> · </Text>
      <Pressable onPress={() => Linking.openURL('https://equationalapplications.com/')}>
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
