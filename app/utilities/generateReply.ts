import { httpsCallable } from "firebase/functions"

import { functions } from "../config/firebaseConfig"

const generateImageFn: any = httpsCallable(functions, "generateReply")

interface GenerateReplyArgs {
  text: string
  id: string
  userId: string
}

export const generateReply = async ({ text, id, userId }: GenerateReplyArgs) => {
  const { data } = await generateImageFn({ text, id, userId })
  return data
}
