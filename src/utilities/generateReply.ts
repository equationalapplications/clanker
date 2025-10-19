import { generateReplyFn } from '../config/firebaseConfig'

interface GenerateReplyArgs {
  text: string
  id: string
  userId: string
}

export const generateReply = async ({ text, id, userId }: GenerateReplyArgs) => {
  const data = await generateReplyFn({ text, id, userId })
  return data
}
