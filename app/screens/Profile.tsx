import { useState } from "react"
import { StyleSheet, View } from "react-native"
import { Text, Avatar } from "react-native-paper"
import { useQueryClient } from "react-query"

import Button from "../components/Button"
import ConfirmationModal from "../components/ConfirmationModal"
import LoadingIndicator from "../components/LoadingIndicator"
import { defaultAvatarUrl } from "../config/constants"
import { auth } from "../config/firebaseConfig"
import { useIsPremium } from "../hooks/useIsPremium"
import useUser from "../hooks/useUser"
import useUserPrivate from "../hooks/useUserPrivate"
import { deleteUser } from "../utilities/deleteUser"

export default function Profile() {
  const queryClient = useQueryClient()
  const user = useUser()
  const userPrivate = useUserPrivate()
  const displayName = user?.displayName
  const email = user?.email
  const photoURL = user?.photoURL ?? defaultAvatarUrl
  const credits = userPrivate?.credits ?? 0
  const isPremium = useIsPremium()

  const [isModalVisible, setIsModalVisible] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  const onPressSignOut = () => {
    queryClient.clear()
    auth.signOut()
  }

  const onPressDeleteAccount = () => {
    setIsModalVisible(true)
  }

  const onConfirmDeleteAccount = async () => {
    setIsModalVisible(false)
    setIsDeleting(true)
    await deleteUser()
    setIsDeleting(false)
  }

  const onCancelDeleteAccount = () => {
    setIsModalVisible(false)
  }

  return (
    <View style={styles.container}>
      {isModalVisible ? null : (
        <>
          <Avatar.Image size={150} source={{ uri: photoURL }} style={{ marginVertical: 10 }} />
          <Text>{displayName}</Text>
          <Text>{email}</Text>
          <Text>Credits: {credits}</Text>
          <Text>
            {isPremium
              ? "You have a subscription for unlimited credit"
              : "You are using free trial credits."}
          </Text>
          <View style={styles.separator} />
          <Button mode="outlined" onPress={onPressSignOut}>
            Sign Out
          </Button>
          {isDeleting ? <LoadingIndicator /> : null}
          <Button mode="text" onPress={onPressDeleteAccount}>
            Delete Account
          </Button>
        </>
      )}
      <ConfirmationModal
        visible={isModalVisible}
        title="Delete Account and Data"
        message="Are you sure you want to delete your account? This action is irreversible and will delete all of your data."
        onCancel={onCancelDeleteAccount}
        onConfirm={onConfirmDeleteAccount}
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
    marginVertical: 30,
    height: 1,
    width: "80%",
  },
})
