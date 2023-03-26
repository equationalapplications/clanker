import { collection, doc, setDoc, CollectionReference } from "firebase/firestore"
import { IMessage } from "react-native-gifted-chat"

import { messagesCollection, userChatsCollection } from "../config/constants"
import { firestore, auth } from "../config/firebaseConfig"

let messagesRef: CollectionReference | null = null

const updateMessages = async (message: IMessage): Promise<void> => {
  if (auth.currentUser) {
    messagesRef = collection(
      firestore,
      userChatsCollection,
      auth.currentUser.uid,
      messagesCollection,
    )

    // add the new message to the messagesRef collection
    try {
      await setDoc(doc(messagesRef), message)
    } catch (error) {
      console.error("Error updating messages: ", error)
    }
  }
}

export default updateMessages
