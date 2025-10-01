import { deleteUser as deleteUserService } from '../services/userService'

/**
 * Delete user account using Supabase
 * This replaces the Firebase Cloud Function approach
 */
export const deleteUser = async () => {
    await deleteUserService()
}