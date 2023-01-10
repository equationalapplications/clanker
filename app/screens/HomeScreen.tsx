import { NativeStackScreenProps } from "@react-navigation/native-stack"
import React, { memo } from "react"

import Background from "../components/Background"
import Button from "../components/Button"
import Header from "../components/Header"
import Logo from "../components/Logo"
import Paragraph from "../components/Paragraph"
import { RootNavigationParamList } from "../navigation/types"

type homeScreenProp = NativeStackScreenProps<RootNavigationParamList, "HomeScreen">

const HomeScreen = ({ navigation }: homeScreenProp) => {
  return (
    <Background>
      <Logo />
      <Header>Login Template</Header>

      <Paragraph>The easiest way to start with your amazing application.</Paragraph>
      <Button mode="contained" onPress={() => navigation.push("LoginScreen")}>
        Login
      </Button>
      <Button mode="outlined" onPress={() => navigation.push("RegisterScreen")}>
        Sign Up
      </Button>
    </Background>
  )
}

export default memo(HomeScreen)
