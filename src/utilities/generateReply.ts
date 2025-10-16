import { functions } from '../config/firebaseConfig'

interface GenerateReplyArgs {
  text: string
  id: string
  userId: string
}

export const generateReply = async ({ text, id, userId }: GenerateReplyArgs) => {
  const generateImageFn = functions.httpsCallable('generateReply')
  const data = await generateImageFn({ text, id, userId })
  return data
}
