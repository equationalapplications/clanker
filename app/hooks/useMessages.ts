import Constants from "expo-constants"
import { collection, onSnapshot, CollectionReference } from "firebase/firestore"
import { useEffect, useState } from "react"
import { IMessage } from "react-native-gifted-chat"

import { firestore } from "../config/firebaseConfig"
import useUser from "./useUser"

interface IMessageWithCreatedAt extends IMessage {
    createdAt: number;
}

const userChatsCollection = Constants.expoConfig.extra.userChatsCollection
const messagesCollection = Constants.expoConfig.extra.messagesCollection

export default function useMessages(): IMessage[] | null {
    const user = useUser()
    const [messages, setMessages] = useState<IMessage[] | null>(null)
    let messagesRef: CollectionReference | null = null

    useEffect(() => {
        if (user) {
            messagesRef = collection(firestore, userChatsCollection, user.uid, messagesCollection)
            const unsubscribe = onSnapshot(messagesRef, (querySnapshot) => {
                const newMessages: IMessageWithCreatedAt[] = [];

                querySnapshot.forEach((doc) => {
                    const message = doc.data()
                    newMessages.push(
                        message as IMessageWithCreatedAt
                    );
                })

                // Sort messages by createdAt timestamp
                newMessages.sort((a, b) => b.createdAt - a.createdAt)

                // Remove createdAt property
                const messagesWithoutCreatedAt = newMessages.map(({ createdAt, ...rest }) => rest)

                setMessages(messagesWithoutCreatedAt)
            })

            return () => unsubscribe()
        }
    }, [user])

    return messages
}
