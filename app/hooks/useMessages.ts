import Constants from "expo-constants";
import {
    collection,
    onSnapshot,
    CollectionReference,
    Unsubscribe,
} from "firebase/firestore";
import { useEffect, useState } from "react";
import { Message } from "react-native-gifted-chat";

import { firestore } from "../config/firebaseConfig";
import useUser from "./useUser";

const userChatsCollection = Constants.expoConfig.extra.userChatsCollection;
const messagesCollection = Constants.expoConfig.extra.messagesCollection;

export default function useMessages(chatId: string) {
    const user = useUser();
    let messagesRef: CollectionReference | null = null;

    if (user) {
        messagesRef = collection(
            firestore,
            userChatsCollection,
            user.uid,
            messagesCollection,
            chatId
        );
    }

    const [messages, setMessages] = useState<Message[] | null>(null);
    let unsubscribe: Unsubscribe | null = null;

    useEffect(() => {
        if (messagesRef) {
            unsubscribe = onSnapshot(messagesRef, (snapshot) => {
                const updatedMessages: Message[] = [];

                snapshot.forEach((doc) => {
                    updatedMessages.push({ ...doc.data(), _id: doc.id } as Message);
                });

                setMessages(updatedMessages);
            });
        }

        return () => {
            if (unsubscribe) {
                unsubscribe();
            }
        };
    }, [messagesRef]);

    return messages;
}
