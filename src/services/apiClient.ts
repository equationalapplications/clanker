import { httpsCallable, getFunctions } from '@react-native-firebase/functions'
import { firebaseApp } from '~/config/firebaseConfig'
import { bootstrapSession } from '~/auth/bootstrapSession'

// Ensure we use the correct region
const functionsInstance = getFunctions(firebaseApp, 'us-central1')

// Re-use bootstrapSession for user state
export const getUserState = async () => {
  return await bootstrapSession()
}

export const updateUserProfile = httpsCallable<{
  displayName?: string | null;
  avatarUrl?: string | null;
  isProfilePublic?: boolean;
  defaultCharacterId?: string | null;
}, any>(functionsInstance, 'updateUserProfile')

export const acceptTermsFn = httpsCallable<{ termsVersion: string }, { success: boolean }>(functionsInstance, 'acceptTerms')

export const syncCharacterFn = httpsCallable<{ character: any }, any>(functionsInstance, 'syncCharacter')
export const deleteCharacterFn = httpsCallable<{ characterId: string }, { success: boolean }>(functionsInstance, 'deleteCharacter')
export const getUserCharactersFn = httpsCallable<void, { characters: any[] }>(functionsInstance, 'getUserCharacters')
