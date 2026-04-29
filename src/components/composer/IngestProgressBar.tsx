import { View, StyleSheet } from 'react-native'
import { useTheme } from 'react-native-paper'

interface IngestProgressBarProps {
  // 0..1 progress value; source of truth is INGEST_STATE_PROGRESS in ~/constants/documentIngestProgress
  progress: number
}

export default function IngestProgressBar({ progress }: IngestProgressBarProps) {
  const { colors } = useTheme()

  if (progress <= 0) return null

  return (
    <View style={styles.track}>
      <View
        style={[
          styles.bar,
          { width: `${Math.min(100, Math.max(0, progress * 100))}%`, backgroundColor: colors.primary },
        ]}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  track: {
    height: 3,
    backgroundColor: 'transparent',
    width: '100%',
  },
  bar: {
    height: 3,
    borderRadius: 1.5,
  },
})
