import { useState, useEffect } from "react"
import { StyleSheet, ScrollView, View } from "react-native"
import { TextInput, Switch, Text } from "react-native-paper"
import { useLocalSearchParams, router } from "expo-router"

import Button from "../components/Button"
import CharacterAvatar from "../components/CharacterAvatar"
import ConfirmationModal from "../components/ConfirmationModal"
import LoadingIndicator from "../components/LoadingIndicator"
import { ShareCharacterButton } from "../components/ShareCharacterButton"
import { defaultAvatarUrl } from "../config/constants"
import { useCharacter } from "../hooks/useCharacter"
import { useIsPremium } from "../hooks/useIsPremium"
import { useAuth } from "../hooks/useAuth"
import { useUserPrivate } from "../hooks/useUserPrivate"
import { generateImage } from "../utilities/generateImage"
import updateCharacter from "../utilities/updateCharacter"

export function EditCharacter() {
  const { user } = useAuth()
  const uid = user?.uid
  const { id } = useLocalSearchParams<{ id: string }>()
  const [isEraseModalVisible, setIsEraseModalVisible] = useState(false)
  const [isSaveModalVisible, setIsSaveModalVisible] = useState(false)
  const character = useCharacter({ id: id!, userId: uid })
  const userPrivate = useUserPrivate()
  const credits = userPrivate?.credits ?? 0
  const isPremium = useIsPremium()
  const [avatar, setAvatar] = useState(character?.avatar ?? defaultAvatarUrl)
  const [appearance, setAppearance] = useState(character?.appearance ?? "")
  const [name, setName] = useState(character?.name ?? "")
  const [traits, setTraits] = useState(character?.traits ?? "")
  const [emotions, setEmotions] = useState(character?.emotions ?? "")
  const [imageIsLoading, setImageIsLoading] = useState(false)
  const [isSwitchOnPublic, setIsSwitchOnPublic] = useState(character?.isCharacterPublic ?? false)

  const onToggleSwitch = () => setIsSwitchOnPublic(!isSwitchOnPublic)

  const onChangeAvatar = (text: string) => setAvatar(text)
  const onChangeAppearance = (text: string) => setAppearance(text)
  const onChangeName = (text: string) => setName(text)
  const onChangeTraits = (text: string) => setTraits(text)
  const onChangeEmotions = (text: string) => setEmotions(text)

  const onConfirmSave = () => {
    setIsSaveModalVisible(false)
    router.back()
  }

  const onCancelErase = () => setIsEraseModalVisible(false)
  const onConfirmErase = async () => {
    setIsEraseModalVisible(false)
    if (uid && id) {
      // Add your erase logic here
    }
  }

  const onPressGenerateImage = async () => {
    if (!isPremium && credits === 0) {
      router.push("./subscribe")
      return
    }

    if (!uid) {
      console.error('User ID is required for image generation')
      return
    }

    setImageIsLoading(true)
    try {
      const text = `${appearance} ${name} ${traits} ${emotions}`.trim()
      const imageUrl = await generateImage({ text, characterId: id!, userId: uid })
      if (imageUrl) {
        setAvatar(imageUrl)
      }
    } catch (error) {
      console.error('Error generating image:', error)
      // Could show an error message to user here
    }
    setImageIsLoading(false)
  }

  const onPressSave = async () => {
    if (!uid || !id) return

    await updateCharacter({
      characterId: id,
      name,
      appearance,
      traits,
      emotions,
      avatar,
      isCharacterPublic: isSwitchOnPublic,
    })

    setIsSaveModalVisible(true)
  }

  useEffect(() => {
    if (character) {
      setAvatar(character.avatar || defaultAvatarUrl)
      setAppearance(character.appearance || "")
      setName(character.name || "")
      setTraits(character.traits || "")
      setEmotions(character.emotions || "")
      setIsSwitchOnPublic(character.isCharacterPublic || false)
    }
  }, [character])

  if (!character) {
    return <LoadingIndicator />
  }

  return (
    <View style={styles.container}>
      <ScrollView style={{ marginTop: 30 }} contentContainerStyle={styles.scrollContentContainer}>
        <CharacterAvatar
          size={100}
          imageUrl={avatar}
          characterName={name}
          showFallback={true}
        />
        <TextInput
          mode="outlined"
          label="Avatar URL"
          value={avatar}
          onChangeText={onChangeAvatar}
          style={styles.textInput}
        />
        <Button
          onPress={onPressGenerateImage}
          mode="contained"
          loading={imageIsLoading}
          disabled={imageIsLoading}
        >
          Generate Avatar
        </Button>
        <View style={styles.separator} />
        <TextInput
          mode="outlined"
          label="Name"
          value={name}
          onChangeText={onChangeName}
          style={styles.textInput}
        />
        <View style={styles.separator} />
        <TextInput
          mode="outlined"
          label="Appearance"
          value={appearance}
          onChangeText={onChangeAppearance}
          style={styles.textInput}
          multiline
        />
        <View style={styles.separator} />
        <TextInput
          mode="outlined"
          label="Traits"
          value={traits}
          onChangeText={onChangeTraits}
          style={styles.textInput}
          multiline
        />
        <View style={styles.separator} />
        <TextInput
          mode="outlined"
          label="Emotions"
          value={emotions}
          onChangeText={onChangeEmotions}
          style={styles.textInput}
          multiline
        />
        <View style={styles.separator} />
        <Button onPress={onPressSave} mode="contained">
          Save Character
        </Button>
        <View style={styles.separator} />
        <Button
          onPress={() => router.push(`../chat/${id}`)}
          mode="contained"
          buttonColor="#4CAF50"
        >
          Chat with {name || "Character"}
        </Button>
        <View style={styles.separator} />
        <Button onPress={() => setIsEraseModalVisible(true)} mode="outlined">
          Delete Character Memory
        </Button>
        <View style={styles.separator} />
        <>
          <Text>{isSwitchOnPublic ? "Public" : "Private"}</Text>
          <Switch value={isSwitchOnPublic} onValueChange={onToggleSwitch} />
        </>
        <View style={styles.separator} />
        <ShareCharacterButton id={id!} userId={uid} disabled={!isSwitchOnPublic} />
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