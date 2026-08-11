import React from 'react'
import { View, Text as RNText, TouchableOpacity, Linking, Platform, StyleSheet } from 'react-native'
import type { GroundingMetadata } from '@google/genai'
import { GroundingHtml } from '~/components/GroundingHtml'
import { isSafeHttpUrl } from '~/utils/isSafeHttpUrl'

interface GroundingFooterProps {
  metadata: GroundingMetadata
}

export function GroundingFooter({ metadata }: GroundingFooterProps) {
  const chunks = metadata.groundingChunks ?? []
  const renderedContent = metadata.searchEntryPoint?.renderedContent
  if (chunks.length === 0 && !renderedContent) return null

  return (
    <View style={styles.container}>
      {chunks.length > 0 && (
        <View
          style={styles.citationRow}
          accessibilityRole={Platform.OS === 'web' ? ('list' as any) : undefined}
          accessibilityLabel="Search sources"
        >
          {chunks.map((chunk, index) => {
            const uri = chunk.web?.uri
            const title = chunk.web?.title ?? uri
            if (!uri || !title || !isSafeHttpUrl(uri)) return null
            return (
              <TouchableOpacity
                key={`${uri}-${index}`}
                style={styles.citationChip}
                onPress={() => {
                  void Linking.openURL(uri).catch((error) => {
                    console.warn('Failed to open citation URL', error)
                  })
                }}
                accessibilityRole="link"
                accessibilityLabel={title}
              >
                <RNText style={styles.citationChipText} numberOfLines={1}>
                  {title}
                </RNText>
              </TouchableOpacity>
            )
          })}
        </View>
      )}
      {renderedContent && <GroundingHtml html={renderedContent} style={styles.searchSuggestions} />}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 8,
    paddingBottom: Platform.OS === 'web' ? 0 : 8,
    gap: 6,
    overflow: 'hidden',
    width: '100%',
    maxWidth: '100%',
    minWidth: 0,
  },
  citationRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  citationChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.06)',
    maxWidth: 220,
  },
  citationChipText: {
    fontSize: 12,
  },
  searchSuggestions: {
    backgroundColor: 'transparent',
    width: '100%',
    maxWidth: '100%',
    minWidth: 0,
    alignSelf: 'stretch',
  },
})