import { StyleSheet, ScrollView, View, Linking } from 'react-native'
import { Text, useTheme, Button } from 'react-native-paper'
import { TERMS } from '~/config/termsConfig'
import { APPLE_EULA_URL } from '~/config/constants'

export default function Terms() {
  const { colors } = useTheme()

  const handleOpenAppleEula = async () => {
    try {
      await Linking.openURL(APPLE_EULA_URL)
    } catch (e) {
      console.error('Failed to open Apple EULA URL:', e)
    }
  }

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
      <ScrollView contentContainerStyle={styles.scrollView}>
        <Text>{TERMS.terms}</Text>
        <View style={styles.separator} />
        <View style={styles.appleEulaSection}>
          <Button mode="outlined" onPress={handleOpenAppleEula} style={styles.eulaButton}>
            View Apple Standard EULA
          </Button>
        </View>
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
  appleEulaSection: {
    marginTop: 20,
    marginBottom: 20,
  },
  eulaButton: {
    marginTop: 8,
  },
})
