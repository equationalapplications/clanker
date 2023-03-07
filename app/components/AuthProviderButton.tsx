import { StyleSheet, ViewStyle } from "react-native"
import { Button } from "react-native-paper"
import Icon from "react-native-vector-icons/MaterialCommunityIcons"

type SocialType = "facebook" | "google" | "apple" | "phone"

interface Props {
  style?: ViewStyle
  type: SocialType
  onPress: () => void
  loading?: boolean
  children: string
  disabled?: boolean
}

function getSocialColor(type: SocialType): string {
  switch (type) {
    case "facebook":
      return "#4267B2"
    case "google":
      return "#F96458"
    case "apple":
      return "#000000"
    case "phone":
      return "#b24292"
  }
}

function ProviderButton({ style, type, onPress, loading, children, disabled }: Props): JSX.Element {
  return (
    <Button
      style={[styles.button, style]}
      icon={() => <Icon name={type} color="#fff" size={17} />}
      mode="contained"
      color={getSocialColor(type)}
      dark
      loading={loading}
      onPress={() => (loading ? null : onPress())}
      disabled={disabled}
    >
      {children}
    </Button>
  )
}

export default ProviderButton

const styles = StyleSheet.create({
  button: {
    marginVertical: 5,
    width: 300,
  },
})
