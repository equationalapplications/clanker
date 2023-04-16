import { collection, onSnapshot, CollectionReference } from "firebase/firestore"
import { useEffect, useState, useRef } from "react"
import { IMessage } from "react-native-gifted-chat"

import { useUser } from "./useUser"
import {
  userChatsCollection,
  messagesCollection,
  usersPublicCollection,
  charactersCollection,
} from "../config/constants"
import { firestore } from "../config/firebaseConfig"

interface UseChatMessagesArgs {
  id: string
  userId: string
}

export function useChatMessages({ id, userId }: UseChatMessagesArgs): IMessage[] {
  const user = useUser()
  const [messages, setMessages] = useState<IMessage[]>([])
  const messagesRef = useRef<CollectionReference | null>(null)

  useEffect(() => {
    if (user && id && userId) {
      messagesRef.current = collection(
        firestore,
        userChatsCollection,
        user.uid,
        usersPublicCollection,
        userId,
        charactersCollection,
        id,
        messagesCollection,
      )
      const unsubscribe = onSnapshot(
        messagesRef.current,
        (querySnapshot) => {
          const newMessages: IMessage[] = []

          querySnapshot.forEach((doc) => {
            const message = doc.data()
            newMessages.push(message as IMessage)
          })

          // Sort messages by createdAt timestamp
          newMessages.sort((a, b) => (b.createdAt as number) - (a.createdAt as number))

          setMessages(newMessages)
        },
        (error) => {
          console.error("Error fetching messages:", error)
          setMessages([])
        },
      )

      return () => unsubscribe()
    }
  }, [user])

  return messages
}
