import { NavigationContainer } from "@react-navigation/native"
import { createNativeStackNavigator } from "@react-navigation/native-stack"
import { useAuthUser } from "@react-query-firebase/auth"

import { auth } from "../config/firebaseConfig"
import SignedInStack from "./SignedInStack"
import SignedOutStack from "./SignedOutStack"

const RootStack = createNativeStackNavigator()

const RootNavigator = () => {
  const user = useAuthUser(["user"], auth)
  return (
    <NavigationContainer>
      user.data ? (
      <SignedInStack />
      ) : (
      <SignedOutStack />
      );
    </NavigationContainer>
  )
}

export default RootNavigator
