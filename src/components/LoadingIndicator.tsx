import React from 'react'
import { ActivityIndicator } from 'react-native-paper'

interface Props {
  disabled?: boolean
}

const LoadingIndicator = ({ disabled }: Props) => {
  if (disabled) {
    return null
  }

  return <ActivityIndicator size="large" />
}

export default LoadingIndicator
