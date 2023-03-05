import { FontAwesome } from "@expo/vector-icons"
import * as Font from "expo-font"
import * as SplashScreen from "expo-splash-screen"
import { useEffect, useState } from "react"
import { useAuthUser } from "@react-query-firebase/auth"
import { firestore, auth } from "../config/firebaseConfig"
import {
  useFirestoreDocumentMutation,
  useFirestoreDocumentData,
} from "@react-query-firebase/firestore"
import { doc } from "firebase/firestore"

export default function useCachedResources() {
  const [isLoadingComplete, setLoadingComplete] = useState(false)

  // Load any resources or data that we need prior to rendering the app
  useEffect(() => {
    async function loadResourcesAndDataAsync() {
      try {
        SplashScreen.preventAutoHideAsync()

        const user = useAuthUser(["user"], auth)
        const uid = user?.data?.uid ?? ""
        const userPrivateRef = doc(firestore, "users_private", uid)
        const userPrivate = useFirestoreDocumentData(["userPrivate"], userPrivateRef, {
          subscribe: true,
        })
        const defaultCharacterId = userPrivate.data?.defaultCharacter ?? "0"
        const defaultCharacterRef = doc(
          firestore,
          "characters",
          uid,
          "user_characters",
          defaultCharacterId,
        )
        const defaultCharacter = useFirestoreDocumentData(
          ["defaultCharacter", defaultCharacterId],
          defaultCharacterRef,
          {
            subscribe: true,
          },
        )
        console.log(defaultCharacter.data)

        // Load fonts
        await Font.loadAsync({
          ...FontAwesome.font,
          "space-mono": require("../../assets/fonts/SpaceMono-Regular.ttf"),
        })
      } catch (e) {
        // We might want to provide this error information to an error reporting service
        console.warn(e)
      } finally {
        setLoadingComplete(true)
        SplashScreen.hideAsync()
      }
    }

    loadResourcesAndDataAsync()
  }, [])

  return isLoadingComplete
}
