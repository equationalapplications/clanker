import { NavigationContainer } from "@react-navigation/native"
import auth, { FirebaseAuthTypes } from "firebase/auth"
import { createContext, Fragment, ReactNode, useEffect, useState } from "react"
import { StyleSheet, View } from "react-native"
import { Headline, ActivityIndicator, Provider as PaperProvider } from "react-native-paper"
import { AlertsProvider } from "react-native-paper-alerts"
import { initialWindowMetrics, SafeAreaProvider } from "react-native-safe-area-context"

import { useAppSettings } from "./components/AppSettings"
import SignedInStack from "./signed-in/Stack"
import SignedOutStack from "./signed-out/Stack"

/**
 * Types
 */
type User = FirebaseAuthTypes.User | null

/**
 * Contexts
 */
export const UserContext = createContext<User>(null)

function App(): JSX.Element {
  const [initializing, setInitializing] = useState(true)
  const [listenUser, setListenUser] = useState(false)
  const [user, setUser] = useState<User>(null)
  const appSettings = useAppSettings()

  /** Listen for auth state changes */
  useEffect(() => {
    const authListener = auth().onAuthStateChanged((result) => {
      setUser(result)
      if (initializing && !listenUser) {
        setInitializing(false)
        setListenUser(true)
      }
    })

    return () => {
      if (authListener) {
        authListener()
      }
    }
  }, [initializing, listenUser])

  /** Listen for user changes */
  useEffect(() => {
    let userListener: () => void

    if (listenUser) {
      userListener = auth().onIdTokenChanged((result) => {
        setUser(result)
      })
    }

    return () => {
      if (userListener) {
        userListener()
      }
    }
  }, [listenUser])

  if (initializing) {
    let waiting = true
    setTimeout(() => {
      waiting = false
    }, 1000)

    return (
      <View
        style={[
          styles.loadingContainer,
          { backgroundColor: appSettings.currentTheme.colors.background },
        ]}
      >
        {!waiting && (
          <>
            <Headline style={[styles.padded, { color: appSettings.currentTheme.colors.text }]}>
              {appSettings.t("loading")}...
            </Headline>
            <ActivityIndicator
              size="large"
              theme={{
                ...appSettings.currentTheme,
                colors: { primary: appSettings.currentTheme.colors.accent },
              }}
            />
          </>
        )}
      </View>
    )
  }

  function container(children: ReactNode | ReactNode[]) {
    return (
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <PaperProvider theme={appSettings.currentTheme}>
          <AlertsProvider>
            <NavigationContainer
              linking={{
                prefixes: [
                  "invertase.github.io/react-native-firebase-authentication-example",
                  "localhost",
                ],
                config: {
                  screens: {
                    // Our signed-out stack has these:
                    SignIn: "",
                    CreateAccount: "account/create",
                    ForgotPassword: "account/password/forgot",
                    PhoneSignIn: "account/phone/login",
                    // Used as catch-all - there is a "Home" in signed-in and signed-out stacks!
                    NotFound: "*",

                    Details: "details", // included from Luna template app
                    User: "user",
                    UserProfile: "profile",
                    UserSettings: "profile/edit",
                  },
                },
              }}
              documentTitle={{
                formatter: (options, route) =>
                  `${
                    options?.title || route?.name ? " - " + options?.title ?? route?.name : " "
                  }`,
              }}
              theme={appSettings.currentTheme}
            >
              {children}
            </NavigationContainer>
          </AlertsProvider>
        </PaperProvider>
      </SafeAreaProvider>
    )
  }

  return container(
    user ? (
      <UserContext.Provider value={user}>
        <SignedInStack />
      </UserContext.Provider>
    ) : (
      <SignedOutStack />
    ),
  )
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignContent: "center",
    // alignSelf: 'center',
    alignItems: "center",
    // textAlignVertical: true,
  },
  padded: {
    padding: 40,
  },
})

export default App
