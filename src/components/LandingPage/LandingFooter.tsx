import { View, StyleSheet, Pressable, Linking, Platform } from 'react-native'
import { Text, useTheme } from 'react-native-paper'
import { useCookieConsent } from '~/components/CookieConsent'
import { FOOTER_LINKS } from '~/config/landingConfig'

export default function LandingFooter() {
  const { colors } = useTheme()
  const { openPreferences } = useCookieConsent()

  const linkStyle = StyleSheet.flatten([styles.link, { color: colors.outline }])

  const renderLink = (link: (typeof FOOTER_LINKS)[number]) => {
    if (link.external) {
      return (
        <Pressable
          key={link.href}
          accessibilityRole="link"
          accessibilityLabel={`${link.label}, opens external website`}
          onPress={() => {
            void Linking.openURL(link.href).catch((error) => {
              console.warn('Failed to open external link', error)
            })
          }}
        >
          <Text variant="bodySmall" style={linkStyle}>
            {link.label}
          </Text>
        </Pressable>
      )
    }

    return (
      <Pressable
        key={link.href}
        accessibilityRole="link"
        onPress={() => {
          if (Platform.OS === 'web') {
            window.location.assign(link.href)
          }
        }}
      >
        <Text variant="bodySmall" style={linkStyle}>
          {link.label}
        </Text>
      </Pressable>
    )
  }

  return (
    <View style={styles.footer}>
      {FOOTER_LINKS.map((link, index) => (
        <View key={link.href} style={styles.linkGroup}>
          {index > 0 ? (
            <Text variant="bodySmall" style={{ color: colors.outline }}>
              {' '}
              ·{' '}
            </Text>
          ) : null}
          {renderLink(link)}
        </View>
      ))}
      {Platform.OS === 'web' && (
        <>
          <Text variant="bodySmall" style={{ color: colors.outline }}>
            {' '}
            ·{' '}
          </Text>
          <Pressable accessibilityRole="link" onPress={openPreferences}>
            <Text variant="bodySmall" style={linkStyle}>
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
    columnGap: 4,
    rowGap: 4,
  },
  linkGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  link: {
    textDecorationLine: 'underline',
  },
})
