import { deleteUser as deleteUserSupabase } from '../services/userService'

/**
 * Delete user account using Supabase
 * This replaces the Firebase Cloud Function approach
 */
export const deleteUser = async () => {
  await deleteUserSupabase()
}
