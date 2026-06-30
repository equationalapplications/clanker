import { StyleSheet, View } from 'react-native'
import { Text } from 'react-native-paper'

function renderInline(text: string, baseStyle: object) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <Text key={index} style={[baseStyle, styles.bold]}>
          {part.slice(2, -2)}
        </Text>
      )
    }
    return (
      <Text key={index} style={baseStyle}>
        {part}
      </Text>
    )
  })
}

export function PolicyMarkdown({ content }: { content: string }) {
  const lines = content.trim().split('\n')

  return (
    <View>
      {lines.map((line, index) => {
        if (line.startsWith('## ')) {
          return (
            <Text key={index} style={styles.heading}>
              {line.slice(3)}
            </Text>
          )
        }
        if (line === '') {
          return <View key={index} style={styles.spacer} />
        }
        return (
          <Text key={index} style={styles.paragraph}>
            {renderInline(line, styles.paragraph)}
          </Text>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  heading: {
    fontSize: 18,
    fontWeight: '700',
    marginTop: 16,
    marginBottom: 8,
  },
  paragraph: {
    fontSize: 16,
    lineHeight: 24,
  },
  bold: {
    fontWeight: '700',
  },
  spacer: {
    height: 12,
  },
})
