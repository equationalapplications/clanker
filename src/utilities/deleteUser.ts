import { deleteUser as deleteUserSupabase } from '../services/userService'

/**
 * Delete user account via the deleteMyAccount Cloud Function.
 * Hard-deletes Firebase Auth, Supabase Auth, app data, and subscriptions.
 */
export const deleteUser = async () => {
  await deleteUserSupabase()
}
