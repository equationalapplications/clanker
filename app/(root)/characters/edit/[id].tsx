import { useState, useEffect } from "react"
import { StyleSheet, ScrollView, View } from "react-native"
import { TextInput, Switch, Text, Avatar } from "react-native-paper"
import { useLocalSearchParams, router } from "expo-router"

import Button from "../../../../src/components/Button"
import ConfirmationModal from "../../../../src/components/ConfirmationModal"
import LoadingIndicator from "../../../../src/components/LoadingIndicator"
import { ShareCharacterButton } from "../../../../src/components/ShareCharacterButton"
import { defaultAvatarUrl } from "../../../../src/config/constants"
import { useCharacter } from "../../../../src/hooks/useCharacter"
import { useIsPremium } from "../../../../src/hooks/useIsPremium"
import { useAuth } from "../../../../src/hooks/useAuth"
import { useUserPrivate } from "../../../../src/hooks/useUserPrivate"
import { generateImage } from "../../../../src/utilities/generateImage"
import updateCharacter from "../../../../src/utilities/updateCharacter"

export default function EditCharacter() {
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
    const [textIsLoading, setTextIsLoading] = useState(false)
    const [isSwitchOnPublic, setIsSwitchOnPublic] = useState(character?.isCharacterPublic ?? false)

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

    const onChangeTextName = (text: string) => setName(text)
    const onChangeTextAppearance = (text: string) => setAppearance(text)
    const onChangeTextTraits = (text: string) => setTraits(text)
    const onChangeTextEmotions = (text: string) => setEmotions(text)

    const onToggleSwitch = async () => {
        if (!character?.id) return
        setTextIsLoading(true)
        try {
            await updateCharacter({
                characterId: character.id,
                isCharacterPublic: !isSwitchOnPublic,
            })
            setIsSwitchOnPublic(!isSwitchOnPublic)
        } catch (error) {
            console.error('Error updating character public status:', error)
        }
        setTextIsLoading(false)
    }

    const onPressSave = async () => {
        if (!character?.id) return
        if (credits <= 0 && !isPremium) {
            router.push('/subscribe')
            return
        }
        setTextIsLoading(true)
        try {
            await updateCharacter({
                characterId: character.id,
                name,
                appearance,
                traits,
                emotions,
            })
            setIsSaveModalVisible(true)
        } catch (error) {
            console.error('Error saving character:', error)
        }
        setTextIsLoading(false)
    }

    const onConfirmSave = () => {
        setIsSaveModalVisible(false)
    }

    const onPressChat = () => {
        if (character?.id) {
            router.push(`../chat/${character.id}`)
        }
    }

    const onPressGenerate = async () => {
        if (!character?.id || !uid) return
        if (credits <= 0 && !isPremium) {
            router.push('/subscribe')
            return
        }
        setImageIsLoading(true)
        try {
            const promptText = `A profile picture of ${appearance}, who is ${traits}, and is feeling ${emotions}.`
            const imageUrl = await generateImage({
                text: promptText,
                characterId: character.id,
                userId: uid
            })
            if (imageUrl) {
                setAvatar(imageUrl)
            }
        } catch (error) {
            console.error('Error generating image:', error)
        }
        setImageIsLoading(false)
    }

    const onPressErase = () => {
        if (credits <= 0 && !isPremium) {
            router.push('/subscribe')
            return
        }
        setIsEraseModalVisible(true)
    }

    const onCancelErase = () => {
        setIsEraseModalVisible(false)
    }

    const onConfirmErase = async () => {
        if (!character?.id) return
        setIsEraseModalVisible(false)
        setTextIsLoading(true)
        try {
            await updateCharacter({
                characterId: character.id,
                context: ""
            })
        } catch (error) {
            console.error('Error erasing character memory:', error)
        }
        setTextIsLoading(false)
    }

    if (!character) {
        return <LoadingIndicator />
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