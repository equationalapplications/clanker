import { StyleSheet, ScrollView, View } from 'react-native'
import { Text } from 'react-native-paper'
import { PRIVACY } from '~/config/privacyConfig'

export default function Privacy() {

  if (!PRIVACY) {
    return (
      <View style={styles.container}>
        <Text>Privacy policy not available.</Text>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      {/* Header with top-right small version/lastUpdated */}
      <View style={styles.headerRow}>
        <View />
        <Text style={styles.versionText}>
          v{PRIVACY.version} • {PRIVACY.lastUpdated}
        </Text>
      </View>

      <View style={styles.separator} />
      <ScrollView contentContainerStyle={styles.scrollView}>
        <Text>{PRIVACY.privacy}</Text>
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
    color: '#666',
    textAlign: 'right',
  },
})
