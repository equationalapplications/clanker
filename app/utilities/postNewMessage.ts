import { collection, doc, setDoc, CollectionReference } from "firebase/firestore"
import { IMessage } from "react-native-gifted-chat"

import {
  messagesCollection,
  userChatsCollection,
  usersPublicCollection,
  charactersCollection,
} from "../config/constants"
import { firestore, auth } from "../config/firebaseConfig"

let messagesRef: CollectionReference | null = null

interface PostNewMessageArgs {
  message: IMessage
  id: string
  userId: string
}

export const postNewMessage = async ({
  message,
  id,
  userId,
}: PostNewMessageArgs): Promise<void> => {
  if (auth.currentUser && id && userId) {
    try {
      messagesRef = collection(
        firestore,
        userChatsCollection,
        auth.currentUser.uid,
        usersPublicCollection,
        userId,
        charactersCollection,
        id,
        messagesCollection,
      )

      // add the new message to the messagesRef collection
      await setDoc(doc(messagesRef), message)
    } catch (error) {
      throw new Error(error)
    }
  }
}
