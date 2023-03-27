import { collection, onSnapshot, CollectionReference } from "firebase/firestore"
import { useEffect, useMemo, useState } from "react"
import { IMessage } from "react-native-gifted-chat"

import { userChatsCollection, messagesCollection } from "../config/constants"
import { firestore } from "../config/firebaseConfig"
import useUser from "./useUser"

export default function useMessages(): IMessage[] | null {
  const user = useUser()
  const [messages, setMessages] = useState<IMessage[] | null>(null)
  let messagesRef: CollectionReference | null = null

  useEffect(() => {
    if (user) {
      messagesRef = collection(firestore, userChatsCollection, user.uid, messagesCollection)
      const unsubscribe = onSnapshot(messagesRef, (querySnapshot) => {
        const newMessages: IMessage[] = []

        querySnapshot.forEach((doc) => {
          const message = doc.data()
          newMessages.push(message as IMessage)
        })

        // Sort messages by createdAt timestamp
        newMessages.sort((a, b) => (b.createdAt as number) - (a.createdAt as number))

        setMessages(newMessages)
      })

      return () => unsubscribe()
    }
  }, [user])

  if (!user) {
    return null
  }

  const memoizedMessages = useMemo(() => messages, [messages])

  return memoizedMessages
}