import { httpsCallable } from "firebase/functions"

import { functions } from "../config/firebaseConfig"

const setDefaultCharacterFn: any = httpsCallable(functions, "setDefaultCharacter")

interface SetDefaultCharacterArgs {
  characterId: string
}

export const setDefaultCharacter = async ({ characterId }: SetDefaultCharacterArgs) => {
  if (!characterId) throw new Error("No characterId provided")
  const { data } = await setDefaultCharacterFn({ characterId })
  return data
}
