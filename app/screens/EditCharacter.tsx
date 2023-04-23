import { NativeStackNavigationProp } from "@react-navigation/native-stack"
import { useState, useEffect } from "react"
import { StyleSheet, ScrollView, View } from "react-native"
import { TextInput, Avatar, Switch, Text } from "react-native-paper"

import Button from "../components/Button"
import ConfirmationModal from "../components/ConfirmationModal"
import LoadingIndicator from "../components/LoadingIndicator"
import { ShareCharacterButton } from "../components/ShareCharacterButton"
import { defaultAvatarUrl } from "../config/constants"
import useCharacter from "../hooks/useCharacter"
import { useIsPremium } from "../hooks/useIsPremium"
import { useUser } from "../hooks/useUser"
import { useUserPrivate } from "../hooks/useUserPrivate"
import { CharacterStackScreenProps, RootStackParamList } from "../navigation/types"
import { generateImage } from "../utilities/generateImage"
import updateCharacter from "../utilities/updateCharacter"

type RootStackNavigationProp = NativeStackNavigationProp<RootStackParamList>

export function EditCharacter({ navigation, route }: CharacterStackScreenProps<"EditCharacter">) {
  const user = useUser()
  const uid = user?.uid
  const { id } = route.params
  const [isEraseModalVisible, setIsEraseModalVisible] = useState(false)
  const [isSaveModalVisible, setIsSaveModalVisible] = useState(false)
  const character = useCharacter({ id, userId: uid })
  const userPrivate = useUserPrivate()
  const credits = userPrivate?.credits ?? 0
  const isPremium = useIsPremium()
  const [avatar, setAvatar] = useState(character?.avatar ?? defaultAvatarUrl)
  const [appearance, setAppearance] = useState(character?.appearance ?? "")
  const [name, setName] = useState(character?.name ?? "")
  const [traits, setTraits] = useState(character?.traits ?? "")
  const [emotions, setEmotions] = useState(character?.emotions ?? "")
  const [imageIsLoading, setImageIsLoading] = useState(false)
  const [textIsLoading, setTextIsLoading] = useState(false)
  const [isSwitchOnPublic, setIsSwitchOnPublic] = useState(character?.isCharacterPublic ?? false)

  useEffect(() => {
    const updateState = () => {
      setAvatar(character?.avatar ?? defaultAvatarUrl)
      setName(character?.name ?? "")
      setAppearance(character?.appearance ?? "")
      setTraits(character?.traits ?? "")
      setEmotions(character?.emotions ?? "")
      setIsSwitchOnPublic(character?.isCharacterPublic ?? false)
    }
    updateState()

    const unsubscribe = navigation.addListener("focus", updateState)

    return unsubscribe
  }, [navigation, character])

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

  const onToggleSwitch = async () => {
    setTextIsLoading(true)
    await updateCharacter({
      characterId: character.id,
      isCharacterPublic: !isSwitchOnPublic,
    })
    setIsSwitchOnPublic(!isSwitchOnPublic)
    setTextIsLoading(false)
  }

  const onPressSave = async () => {
    if (credits <= 0 && !isPremium) {
      navigation.getParent().navigate("Subscribe")
    }
    setTextIsLoading(true)
    await updateCharacter({
      characterId: character.id,
      name,
      appearance,
      traits,
      emotions,
    })
    setTextIsLoading(false)
    setIsSaveModalVisible(true)
  }

  const onConfirmSave = () => {
    setIsSaveModalVisible(false)
  }

  const onPressChat = () => {
    const parentNavigation = navigation.getParent<RootStackNavigationProp>()
    parentNavigation.push("Home", { screen: "Chat", params: { id: character.id, userId: uid } })
  }

  const onPressGenerate = async () => {
    if (credits <= 0 && !isPremium) {
      navigation.getParent().navigate("Subscribe")
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
    await generateImage({
      text: promptText,
      characterId: id,
    })
    setImageIsLoading(false)
  }

  const onPressErase = async () => {
    if (credits <= 0 && !isPremium) {
      navigation.getParent().navigate("Subscribe")
    }
    setIsEraseModalVisible(true)
  }

  const onCancelErase = () => {
    setIsEraseModalVisible(false)
  }

  const onConfirmErase = async () => {
    setIsEraseModalVisible(false)
    setTextIsLoading(true)
    await updateCharacter({ characterId: character.id, context: "" })
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
        <Button mode="contained" onPress={onPressChat}>
          Chat Now
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
        <View style={styles.separator} />
        <>
          <Text>{isSwitchOnPublic ? "Public" : "Private"}</Text>
          <Switch value={isSwitchOnPublic} onValueChange={onToggleSwitch} />
        </>
        <View style={styles.separator} />
        <ShareCharacterButton id={id} userId={uid} disabled={!isSwitchOnPublic} />
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
        onConfirm={onConfirmSave}
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
    marginVertical: 8,
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
