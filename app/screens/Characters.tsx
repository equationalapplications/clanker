import { httpsCallable } from "firebase/functions"
import { useState, useEffect } from "react"
import { StyleSheet, ScrollView, View } from "react-native"
import { TextInput, Avatar } from "react-native-paper"

import Button from "../components/Button"
import ConfirmationModal from "../components/ConfirmationModal"
import LoadingIndicator from "../components/LoadingIndicator"
import { defaultAvatarUrl } from "../config/constants"
import { functions } from "../config/firebaseConfig"
import useDefaultCharacter from "../hooks/useDefaultCharacter"
import { useIsPremium } from "../hooks/useIsPremium"
import useUserPrivate from "../hooks/useUserPrivate"
import updateCharacter from "../utilities/updateCharacter"

const getImageFn: any = httpsCallable(functions, "getImage")

export default function Characters({ navigation }) {
  const [isEraseModalVisible, setIsEraseModalVisible] = useState(true)
  const [isSaveModalVisible, setIsSaveModalVisible] = useState(false)
  const defaultCharacter = useDefaultCharacter()
  const userPrivate = useUserPrivate()
  const credits = userPrivate?.credits ?? 0
  const isPremium = useIsPremium()
  const [avatar, setAvatar] = useState(defaultCharacter?.avatar ?? defaultAvatarUrl)
  const [appearance, setAppearance] = useState(defaultCharacter?.appearance ?? "")
  const [name, setName] = useState(defaultCharacter?.name ?? "")
  const [traits, setTraits] = useState(defaultCharacter?.traits ?? "")
  const [emotions, setEmotions] = useState(defaultCharacter?.emotions ?? "")
  const [imageIsLoading, setImageIsLoading] = useState(false)
  const [textIsLoading, setTextIsLoading] = useState(false)

  useEffect(() => {
    const updateState = () => {
      setAvatar(defaultCharacter?.avatar ?? defaultAvatarUrl)
      setName(defaultCharacter?.name ?? "")
      setAppearance(defaultCharacter?.appearance ?? "")
      setTraits(defaultCharacter?.traits ?? "")
      setEmotions(defaultCharacter?.emotions ?? "")
    }
    updateState()

    const unsubscribe = navigation.addListener("focus", updateState)

    return unsubscribe
  }, [navigation, defaultCharacter])

  const onChangeTextName = (text: string) => {
    setName(text)
  }

  const onChangeTextAppearance = (text: string) => {
    setAppearance(text)
  }

  const onChangeTextTraits = (text: string) => {
    setTraits(text)
  }

  const onChangeTextEmotions = (text: string) => {
    setEmotions(text)
  }

  const onPressSave = async () => {
    if (credits <= 0 && !isPremium) {
      navigation.navigate("Subscribe")
      return
    }
    setTextIsLoading(true)
    await updateCharacter(defaultCharacter._id, {
      name,
      appearance,
      traits,
      emotions,
    })
    setTextIsLoading(false)
    setIsSaveModalVisible(true)
  }

  const onPressGenerate = async () => {
    if (credits <= 0 && !isPremium) {
      navigation.navigate("Subscribe")
      return
    }
    setImageIsLoading(true)
    const promptText =
      "A profile picture of " +
      appearance +
      ", who is " +
      traits +
      ", and is feeling " +
      emotions +
      "."
    const { data } = await getImageFn({
      text: promptText,
      characterId: defaultCharacter._id,
    })
    setImageIsLoading(false)
  }

  const onPressErase = async () => {
    if (credits <= 0 && !isPremium) {
      navigation.navigate("Subscribe")
      return
    }
    setIsEraseModalVisible(true)
  }

  const onCancelErase = () => {
    setIsEraseModalVisible(false)
  }

  const onConfirmErase = async () => {
    setIsEraseModalVisible(false)
    setTextIsLoading(true)
    await updateCharacter(defaultCharacter._id, { context: "" })
    setTextIsLoading(false)
  }

  return (
    <View style={styles.container}>
      <ScrollView
        style={{ marginTop: 30, width: "100%" }}
        contentContainerStyle={styles.scrollContentContainer}
      >
        {imageIsLoading ? (
          <LoadingIndicator />
        ) : (
          <Avatar.Image size={256} source={{ uri: avatar }} />
        )}
        <Button mode="outlined" onPress={onPressGenerate} disabled={imageIsLoading}>
          Generate New Image
        </Button>
        {textIsLoading ? (
          <LoadingIndicator />
        ) : (
          <>
            <TextInput
              label="Name"
              value={name}
              onChangeText={onChangeTextName}
              style={styles.textInput}
              maxLength={30}
            />
            <TextInput
              label="Appearance"
              value={appearance}
              onChangeText={onChangeTextAppearance}
              style={styles.textInput}
              multiline
              numberOfLines={3}
              maxLength={144}
            />
            <TextInput
              label="Traits"
              value={traits}
              onChangeText={onChangeTextTraits}
              style={styles.textInput}
              multiline
              numberOfLines={3}
              maxLength={144}
            />
            <TextInput
              label="Emotions"
              value={emotions}
              onChangeText={onChangeTextEmotions}
              style={styles.textInput}
              multiline
              numberOfLines={3}
              maxLength={144}
            />
          </>
        )}
        <Button mode="outlined" onPress={onPressSave}>
          Save Changes
        </Button>
        <Button mode="outlined" onPress={onPressErase}>
          Erase Memory
        </Button>
      </ScrollView>
      <ConfirmationModal
        visible={isEraseModalVisible}
        title="Delete Character Memory"
        message="Are you sure you want to delete your character's memory? This cannot be undone."
        onCancel={onCancelErase}
        onConfirm={onConfirmErase}
      />
      <ConfirmationModal
        visible={isSaveModalVisible}
        title="Changes Saved"
        message="Your changes have been saved."
        onCancel={null}
        onConfirm={() => setIsSaveModalVisible(false)}
      />
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
