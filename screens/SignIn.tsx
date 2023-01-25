import { useAuthSignInWithCredential } from "@react-query-firebase/auth"
import * as Google from "expo-auth-session/providers/google"
import * as WebBrowser from "expo-web-browser"
import { GoogleAuthProvider } from "firebase/auth"
import { useEffect } from "react"
import { StyleSheet, Button } from "react-native"
import Constants from "expo-constants"

import { auth } from "../app/config/firebaseConfig"
import { View } from "../components/Themed"
import { RootStackScreenProps } from "../navigation/types"

WebBrowser.maybeCompleteAuthSession()

export default function SignIn({ navigation }: RootStackScreenProps<"SignIn">) {
    const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
        clientId: Constants.expoConfig?.extra?.googleAuthClientId,
    })

    const mutation = useAuthSignInWithCredential(auth)

    useEffect(() => {
        if (response?.type === "success") {
            const { id_token } = response.params
            const credential = GoogleAuthProvider.credential(id_token)
            mutation.mutate(credential)
        }
    }, [response])

    return (
        <View style={styles.container}>
            <Button
                disabled={!request}
                title="Google Login"
                onPress={() => {
                    promptAsync()
                }}
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
})
