import { View, StyleSheet } from 'react-native'
import { Text, Button } from 'react-native-paper'

import { auth } from '~/config/firebaseConfig'
import { queryClient } from '~/config/queryClient'

export const CustomFallback = (props: { error: Error; resetError: Function }) => {
  const onPressReset = () => {
    queryClient.clear()
    props.resetError()
    auth.signOut()
  }
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Something happened!</Text>
      <Text>{props.error.toString()}</Text>
      <View style={styles.separator} />
      <Button onPress={onPressReset} mode="contained">
        Try Again
      </Button>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  separator: {
    marginVertical: 30,
    height: 1,
    width: '80%',
  },
  textInput: {
    width: '80%',
  },
  scrollContentContainer: {
    alignItems: 'center',
  },
})
