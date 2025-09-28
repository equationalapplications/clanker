import React from 'react'
import { Text } from "react-native-paper"

export const MonoText = (props: any) => {
  return <Text {...props} style={[props.style, { fontFamily: "space-mono" }]} />
}

export const TitleText = (props: any) => {
  return <Text {...props} style={[props.style, { fontSize: 24 }]} />
}

export const ParagraphText = (props: any) => {
  return <Text {...props} style={[props.style, { width: "60%" }]} />
}
