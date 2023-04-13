import { httpsCallable } from "firebase/functions"

import { functions } from "../config/firebaseConfig"

const generateImageFn: any = httpsCallable(functions, "generateImage")

interface GenerateImageArgs {
  text: string
  characterId: string
}

export const generateImage = async ({ text, characterId }: GenerateImageArgs) => {
  const { data } = await generateImageFn({ text, characterId })
  return data
}
