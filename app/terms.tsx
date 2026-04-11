import { StyleSheet, ScrollView, View, Linking } from 'react-native'
import { Text, useTheme, Button } from 'react-native-paper'
import { TERMS } from '~/config/termsConfig'

const APPLE_EULA_URL = 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/'

export default function Terms() {
  const { colors } = useTheme()

  if (!TERMS) {
    return (
      <View style={styles.container}>
        <Text>Terms not available.</Text>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      {/* Header with top-right small version/lastUpdated */}
      <View style={styles.headerRow}>
        <View />
        <Text style={[styles.versionText, { color: colors.onSurfaceVariant }]}>
          v{TERMS.version} • {TERMS.lastUpdated}
        </Text>
      </View>

      <View style={styles.separator} />
      <View style={styles.eulaSection}>
        <Text style={[styles.eulaText, { color: colors.onSurfaceVariant }]}>
          For auto-renewable subscriptions purchased on iOS, Apple Standard EULA also applies.
        </Text>
        <Button compact mode="text" onPress={() => Linking.openURL(APPLE_EULA_URL)}>
          View Apple Standard EULA
        </Button>
      </View>
      <ScrollView contentContainerStyle={styles.scrollView}>
        <Text>{TERMS.terms}</Text>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollView: {
    marginHorizontal: '10%',
    width: '80%',
  },
  separator: {
    marginVertical: 30,
    height: 1,
    width: '80%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  eulaSection: {
    width: '80%',
    marginBottom: 12,
    alignItems: 'center',
  },
  eulaText: {
    fontSize: 12,
    textAlign: 'center',
  },
  headerRow: {
    width: '100%',
    paddingHorizontal: '5%',
    marginTop: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  versionText: {
    fontSize: 12,
    textAlign: 'right',
  },
})
