import { httpsCallable } from "firebase/functions"

import { functions } from "../config/firebaseConfig"

const getImageFn: any = httpsCallable(functions, "getImage")

interface GetImageArgs {
  text: string
  characterId: string
}

export const getImage = async ({ text, characterId }: GetImageArgs) => {
  const { data } = await getImageFn({ text, characterId })
  return data
}
