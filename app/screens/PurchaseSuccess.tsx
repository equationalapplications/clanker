import { StyleSheet, View } from "react-native"
import { Text, Avatar } from "react-native-paper"

import Button from "../components/Button"
import useCustomerInfo from "../hooks/useCustomerInfo"

const PurchaseSuccess = ({ navigation }) => {
  const customerInfo = useCustomerInfo()
  const onPressReturn = () => navigation.navigate("Root")

  return (
    <View style={styles.container}>
      {customerInfo?.activeSubscriptions?.length > 0 ? (
        <>
          <Text>Purchase Complete</Text>
          <Text>Active Subscriber: {customerInfo?.activeSubscriptions?.length > 0}</Text>
          <Text>Purchase Date: {customerInfo?.originalPurchaseDate}</Text>
          <Text>Expiration Date: {customerInfo?.latestExpirationDate}</Text>
          <Text>Type: {customerInfo?.activeSubscriptions[0]}</Text>
          <Button onPress={onPressReturn}>Return to Main Screen</Button>
        </>
      ) : (
        <Text>Processing Purchase...</Text>
      )}
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

export default PurchaseSuccess
