import * as Clipboard from "expo-clipboard"
import React, { useState } from "react"
import { Share } from "react-native"
import { IconButton, Snackbar, Text } from "react-native-paper"

import { appChatUrl, platform } from "../config/constants"
import { useCharacter } from "../hooks/useCharacter"

export const ShareCharacterButton = ({ id, userId, disabled }) => {
  const character = useCharacter({ id, userId })
  const [visible, setVisible] = useState(false)

  const onDismissSnackBar = () => setVisible(false)

  const title = character?.name ?? "AI Character"
  const url = appChatUrl + `?id=${character?.id}&userId=${userId}`
  const message = url

  const onPressShare = async () => {
    try {
      if (platform === "web") {
        await Clipboard.setStringAsync(message)
        setVisible(true)
      } else {
        await Share.share({
          title,
          url,
          message,
        })
      }
    } catch (error) {
      console.log(error)
    }
  }

  return (
    <>
      {!visible ? <Text>Share</Text> : null}
      <IconButton icon="share" mode="contained" onPress={onPressShare} disabled={disabled} />
      <Snackbar
        visible={visible}
        onDismiss={onDismissSnackBar}
        duration={3000} // 3 seconds
      >
        Copied to clipboard!
      </Snackbar>
    </>
  )
}
