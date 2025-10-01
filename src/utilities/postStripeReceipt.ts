import {
  platform,
  revenueCatPurchasesStripeApiKey,
  revenueCatReceiptsApi,
} from "../config/constants"
import { auth } from "../config/firebaseConfig"
import { queryClient } from "../config/queryClient"

export const postStripeReceipt = async (sessionId: string) => {
  if (platform !== "web" || !sessionId || !auth.currentUser) {
    return
  }

  const uid = auth.currentUser.uid

  try {
    // use post method to send the session ID to the RevenueCat server
    const response = await fetch(revenueCatReceiptsApi, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Platform": "stripe",
        Authorization: `Bearer ${revenueCatPurchasesStripeApiKey}`,
      },
      body: JSON.stringify({
        app_user_id: uid,
        "fetch-token": sessionId,
      }),
    })
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }
    console.log("postStripeReceipt response", response)
    queryClient.invalidateQueries({ queryKey: ["isPremium"] })
  } catch (err) {
    console.error("postStripeReceipt error", err)
    throw err
  }
}
