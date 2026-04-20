import { deleteUser as deleteUserAccount } from '../services/userService'

/**
 * Delete user account via the deleteMyAccount Cloud Function.
 * Hard-deletes Firebase Auth, Cloud SQL app data, and subscriptions.
 */
export const deleteUser = async () => {
  await deleteUserAccount()
}
