import React, { useState } from "react"

import { useIsPremium } from "../hooks/useIsPremium"
import SubscribeButton from "./SubscribeButton"
import SubscriptionInfoButton from "./SubscriptionInfoButton"

export default function CombinedSubscriptionButton() {
  const isPremium = useIsPremium()
  return <>{isPremium ? <SubscriptionInfoButton /> : <SubscribeButton />}</>
}
