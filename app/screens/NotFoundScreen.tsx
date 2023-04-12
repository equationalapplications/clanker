import { RouteProp } from "@react-navigation/native"
import { StyleSheet, View } from "react-native"
import { Text, Button } from "react-native-paper"

import { TitleText } from "../components/StyledText"
import { RootStackScreenProps, RootStackParamList } from "../navigation/types"

type NotFoundScreenRouteProp = RouteProp<RootStackParamList, "NotFound">

type NotFoundScreenProps = RootStackScreenProps<"NotFound"> & {
  route: NotFoundScreenRouteProp
}

export default function NotFoundScreen({ navigation, route }: NotFoundScreenProps) {
  const {
    path,
    //   key,
    //  params
  } = route
  return (
    <View style={styles.container}>
      <TitleText>Page Not Found</TitleText>
      <Text>
        The route {path} {/*with key {key} and params {JSON.stringify(params)}*/} doesn't exist.
      </Text>
      <Button onPress={() => navigation.replace("Tab")}>Go to home screen!</Button>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
})
