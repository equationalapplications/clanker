import { Text, TextProps } from "react-native"

export function MonoText(props: TextProps) {
  return <Text {...props} style={[props.style, { fontFamily: "space-mono" }]} />
}

export function TitleText(props: TextProps) {
  return <Text {...props} style={[props.style, { fontSize: 24 }]} />
}

export function ParagraphText(props: TextProps) {
  return <Text {...props} style={[props.style, { width: "60%" }]} />
}
