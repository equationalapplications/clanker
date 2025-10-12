import { StyleSheet, View, ViewStyle } from 'react-native'
import { Icon, useTheme } from 'react-native-paper'

interface Props {
  type: string
  active: boolean
  style?: ViewStyle
}

const providerMap: { [key: string]: string } = {
  password: 'email-lock',
  facebook: 'facebook',
  google: 'google',
  phone: 'phone',
}

function Provider({ type, active, style }: Props) {
  const theme = useTheme()
  const icon = providerMap[type]

  if (!icon) {
    return null
  }

  return (
    <View style={[style, styles[active ? 'active' : 'inactive']]}>
      <Icon
        source={icon}
        size={24}
        color={active ? theme.colors.primary : theme.colors.onSurface}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  inactive: {
    opacity: 0.3,
  },
  active: {
    opacity: 1,
  },
})

export default Provider
