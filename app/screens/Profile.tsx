import { useNavigation } from "@react-navigation/native"
import { httpsCallable } from "firebase/functions"
import { useMemo, useCallback, useState } from "react"
import { StyleSheet, View } from "react-native"
import { Text, Avatar } from "react-native-paper"

import Button from "../components/Button"
import ConfirmationModal from "../components/ConfirmationModal"
import { defaultAvatarUrl } from "../config/constants"
import { auth, functions } from "../config/firebaseConfig"
import useCustomerInfo from "../hooks/useCustomerInfo"
import useUser from "../hooks/useUser"
import useUserPrivate from "../hooks/useUserPrivate"

const deleteUserFn: any = httpsCallable(functions, "deleteUser")

export default function Profile() {
  const navigation = useNavigation()
  const user = useUser()
  const userPrivate = useUserPrivate()
  const displayName = useMemo(() => user?.displayName, [user])
  const email = useMemo(() => user?.email, [user])
  const photoURL = useMemo(() => user?.photoURL ?? defaultAvatarUrl, [user])
  const credits = useMemo(() => userPrivate?.credits, [userPrivate])
  const customerInfo = useCustomerInfo()

  const [isModalVisible, setIsModalVisible] = useState(false)

  const onPressSignOut = useCallback(() => {
    auth.signOut()
    navigation.navigate("SignIn")
  }, [navigation])

  const onPressDeleteAccount = async () => {
    await deleteUserFn()
    setIsModalVisible(false)
    await auth.signOut()
    navigation.navigate("SignIn")
  }

  return (
    <View style={styles.container}>
      <Avatar.Image size={150} source={{ uri: photoURL }} style={{ marginVertical: 10 }} />
      <Text>{displayName}</Text>
      <Text>{email}</Text>
      <Text>Credits: {credits}</Text>
      <Text>
        {customerInfo
          ? `Active Subscriber: ${customerInfo?.activeSubscriptions?.length > 0}`
          : "Loading Subscription Info..."}
      </Text>
      <View style={styles.separator} />
      <Button mode="outlined" onPress={onPressSignOut}>
        Sign Out
      </Button>
      <View style={styles.separator} />
      <Button mode="text" onPress={() => setIsModalVisible(true)}>
        Delete Account
      </Button>
      <ConfirmationModal
        visible={isModalVisible}
        title="Delete Account and Data"
        message="Are you sure you want to delete your account? This action is irreversible and will delete all of your data."
        onCancel={() => setIsModalVisible(false)}
        onConfirm={onPressDeleteAccount}
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
