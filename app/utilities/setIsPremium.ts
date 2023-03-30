import { httpsCallable } from "firebase/functions"

import { functions } from "../config/firebaseConfig"

const setIsPremiumFn: any = httpsCallable(functions, "setIsPremium")

export default async function setIsPremium() {
  await setIsPremiumFn()
}
