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

type Block = { type: 'heading' | 'paragraph' | 'spacer'; text: string }

function toBlocks(content: string): Block[] {
  const lines = content.trim().split('\n')
  const blocks: Block[] = []
  let paragraphLines: string[] = []

  const flushParagraph = () => {
    if (paragraphLines.length > 0) {
      blocks.push({ type: 'paragraph', text: paragraphLines.join(' ') })
      paragraphLines = []
    }
  }

  for (const line of lines) {
    if (line.startsWith('## ')) {
      flushParagraph()
      blocks.push({ type: 'heading', text: line.slice(3) })
    } else if (line === '') {
      flushParagraph()
      blocks.push({ type: 'spacer', text: '' })
    } else {
      paragraphLines.push(line)
    }
  }
  flushParagraph()

  return blocks
}

export function PolicyMarkdown({ content }: { content: string }) {
  const blocks = toBlocks(content)

  return (
    <View>
      {blocks.map((block, index) => {
        if (block.type === 'heading') {
          return (
            <Text key={index} style={styles.heading}>
              {block.text}
            </Text>
          )
        }
        if (block.type === 'spacer') {
          return <View key={index} style={styles.spacer} />
        }
        return (
          <Text key={index} style={styles.paragraph}>
            {renderInline(block.text, styles.paragraph)}
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
