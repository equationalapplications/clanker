import React, { useState } from "react"

import Button from "../components/Button"
import makePackagePurchase from "../utilities/makePackagePurchase"

export default function SubscribeButton() {
  const [isLoading, setIsLoading] = useState(false)

  const onPressSubscribe = async () => {
    setIsLoading(true)
    await makePackagePurchase()
    setIsLoading(false)
  }

  return (
    <Button onPress={onPressSubscribe} mode="outlined">
      Subscribe Now!
    </Button>
  )
}
