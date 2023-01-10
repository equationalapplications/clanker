import { NativeStackScreenProps } from "@react-navigation/native-stack"
import React, { memo } from "react"

import Background from "../components/Background"
import Button from "../components/Button"
import Header from "../components/Header"
import Logo from "../components/Logo"
import Paragraph from "../components/Paragraph"
import { RootNavigationParamList } from "../navigation/types"

type homeScreenProp = NativeStackScreenProps<RootNavigationParamList, "HomeScreen">

const HomeScreen = (props: homeScreenProp) => {
  return (
    <Background>
      <Logo />
      <Header>Login Template</Header>

      <Paragraph>The easiest way to start with your amazing application.</Paragraph>
      <Button mode="contained" onPress={() => props.navigation.push("LoginScreen")}>
        Login
      </Button>
      <Button mode="outlined" onPress={() => props.navigation.push("RegisterScreen")}>
        Sign Up
      </Button>
    </Background>
  )
}

export default memo(HomeScreen)
