import { httpsCallable } from "firebase/functions"

import { functions } from "../config/firebaseConfig"

const createNewCharacterFn: any = httpsCallable(functions, "createNewCharacter")

export const createNewCharacter = async () => {
  const id = await createNewCharacterFn()
  return id
}
