import { useState, useEffect } from "react"
import { StyleSheet, ScrollView, View } from "react-native"
import { TextInput, Avatar } from "react-native-paper"

import Button from "../components/Button"
import LoadingIndicator from "../components/LoadingIndicator"
import { defaultAvatarUrl } from "../config/constants"
import { useIsPremium } from "../hooks/useIsPremium"
import useUserPrivate from "../hooks/useUserPrivate"
import { RootTabScreenProps } from "../navigation/types"

export default function Characters({ navigation }: RootTabScreenProps<"Characters">) {
  const userPrivate = useUserPrivate()
  const credits = userPrivate?.credits ?? 0
  const isPremium = useIsPremium()

  const onPressEditCharacter = () => {
    navigation.navigate("EditCharacter", { id: userPrivate.defaultCharacter })
  }

  return (
    <View style={styles.container}>
      <ScrollView
        style={{ marginTop: 30, width: "100%" }}
        contentContainerStyle={styles.scrollContentContainer}
      >
        <Button onPress={onPressEditCharacter}>Edit Character</Button>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 20,
    fontWeight: "bold",
  },
  separator: {
    marginVertical: 30,
    height: 1,
    width: "80%",
  },
  textInput: {
    width: "80%",
  },
  scrollContentContainer: {
    alignItems: "center",
  },
})
