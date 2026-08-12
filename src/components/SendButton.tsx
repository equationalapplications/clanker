import React from 'react'
import { View, Text as RNText, TouchableOpacity, StyleSheet } from 'react-native'
import { ActivityIndicator, useTheme } from 'react-native-paper'

interface SendButtonProps {
  onPress: () => void
  disabled: boolean
  isGenerating: boolean
}

export function SendButton({ onPress, disabled, isGenerating }: SendButtonProps) {
  const { colors, roundness } = useTheme()

  if (isGenerating) {
    return (
      <View
        style={styles.spinnerContainer}
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel="Generating response"
        accessibilityState={{ busy: true }}
      >
        <ActivityIndicator size={20} />
      </View>
    )
  }

  return (
    <TouchableOpacity
      style={[
        styles.pill,
        {
          backgroundColor: colors.primaryContainer,
          borderRadius: roundness * 4,
          opacity: disabled ? 0.5 : 1,
        },
      ]}
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessible
      accessibilityRole="button"
      accessibilityLabel="Send message"
      accessibilityState={{ disabled }}
    >
      <RNText style={{ color: colors.onPrimaryContainer, fontWeight: '600', fontSize: 15 }}>
        Send
      </RNText>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  spinnerContainer: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 4,
  },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 4,
  },
})
