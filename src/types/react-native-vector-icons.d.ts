declare module 'react-native-vector-icons/MaterialCommunityIcons' {
  import { ComponentType } from 'react'
  import { ViewProps } from 'react-native'
  const Icon: ComponentType<ViewProps & { name?: string; size?: number; color?: string }>
  export default Icon
}
