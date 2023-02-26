import { Text, TextProps } from "./Themed"

export function MonoText(props: TextProps) {
  return <Text {...props} style={[props.style, { fontFamily: "space-mono" }]} />
}

export function TitleText(props: TextProps) {
  return <Text {...props} style={[props.style, { fontSize: 24 }]} />
}
