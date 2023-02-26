import { StyleSheet } from "react-native"
import { useAuthSignOut } from "@react-query-firebase/auth"

import { auth } from "../config/firebaseConfig"
import { Text, View } from "../components/Themed"
import Button from "../components/Button"

export default function Characters() {
    const authMutation = useAuthSignOut(auth)
    const onPressSignOut = () => {
        authMutation.mutate()
    }
    return (
        <View style={styles.container}>
            <Text style={styles.title}>Characters</Text>
            <View style={styles.separator} lightColor="#eee" darkColor="rgba(255,255,255,0.1)" />
            <Button mode={"contained"} onPress={onPressSignOut}>
                <Text>Sign Out</Text>
            </Button>
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
