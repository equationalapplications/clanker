import { httpsCallable } from "firebase/functions"

import { auth, functions } from "../config/firebaseConfig"
import { queryClient } from "../config/queryClient"

const deleteUserFn = httpsCallable(functions, "deleteUser")

export const deleteUser = async () => {
  await deleteUserFn()
  await auth.currentUser?.delete()
  queryClient.clear()
}
