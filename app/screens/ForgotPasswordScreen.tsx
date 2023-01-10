import { NativeStackScreenProps } from "@react-navigation/native-stack"
import React, { memo, useState } from "react"
import { Text, StyleSheet, TouchableOpacity } from "react-native"

import BackButton from "../components/BackButton"
import Background from "../components/Background"
import Button from "../components/Button"
import Header from "../components/Header"
import Logo from "../components/Logo"
import TextInput from "../components/TextInput"
import { theme } from "../core/theme"
import { emailValidator } from "../core/utils"
import { RootNavigationParamList } from "../navigation/types"

type forgotPasswordScreenScreenScreenProp = NativeStackScreenProps<
  RootNavigationParamList,
  "ForgotPasswordScreen"
>

const ForgotPasswordScreen: React.FC<forgotPasswordScreenScreenScreenProp> = (props) => {
  const [email, setEmail] = useState({ value: "", error: "" })

  const _onSendPressed = () => {
    const emailError = emailValidator(email.value)

    if (emailError) {
      setEmail({ ...email, error: emailError })
      return
    }

    props.navigation.navigate("LoginScreen")
  }

  return (
    <Background>
      <BackButton goBack={() => props.navigation.navigate("LoginScreen")} />

      <Logo />

      <Header>Restore Password</Header>

      <TextInput
        label="E-mail address"
        returnKeyType="done"
        value={email.value}
        onChangeText={(text) => setEmail({ value: text, error: "" })}
        error={!!email.error}
        errorText={email.error}
        autoCapitalize="none"
        autoCompleteType="email"
        textContentType="emailAddress"
        keyboardType="email-address"
      />

      <Button mode="contained" onPress={_onSendPressed} style={styles.button}>
        Send Reset Instructions
      </Button>

      <TouchableOpacity
        style={styles.back}
        onPress={() => props.navigation.navigate("LoginScreen")}
      >
        <Text style={styles.label}>← Back to login</Text>
      </TouchableOpacity>
    </Background>
  )
}

const styles = StyleSheet.create({
  back: {
    width: "100%",
    marginTop: 12,
  },
  button: {
    marginTop: 12,
  },
  label: {
    color: theme.colors.secondary,
    width: "100%",
  },
})

export default memo(ForgotPasswordScreen)
