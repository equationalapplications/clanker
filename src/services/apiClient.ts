import type { BootstrapResponse, UserSnapshot } from '~/auth/bootstrapSession'
import { bootstrapSession } from '~/auth/bootstrapSession'
import {
  acceptTermsFn as acceptTermsCallable,
  deleteCharacterFn as deleteCharacterCallable,
  getUserCharactersFn as getUserCharactersCallable,
  syncCharacterFn as syncCharacterCallable,
  updateUserProfileFn as updateUserProfileCallable,
} from '~/config/firebaseConfig'

type Callable<Req, Res> = (payload: Req) => Promise<{ data: Res }>
type OptionalCallable<Req, Res> = (payload?: Req) => Promise<{ data: Res }>

export interface UpdateUserProfileRequest {
  displayName?: string | null
  avatarUrl?: string | null
  isProfilePublic?: boolean
  defaultCharacterId?: string | null
}

export type UpdateUserProfileResponse = UserSnapshot

export interface AcceptTermsRequest {
  termsVersion: string
}

export interface AcceptTermsResponse {
  success: boolean
}

export interface SyncCharacterPayload {
  id?: string
  name: string
  avatar?: string | null
  appearance?: string | null
  traits?: string | null
  emotions?: string | null
  context?: string | null
  isPublic?: boolean
  createdAt?: string
  updatedAt?: string
}

export interface CharacterSnapshot {
  id: string
  userId: string
  name: string
  avatar: string | null
  appearance: string | null
  traits: string | null
  emotions: string | null
  context: string | null
  isPublic: boolean
  createdAt: string | Date
  updatedAt: string | Date
}

export interface SyncCharacterRequest {
  character: SyncCharacterPayload
}

export interface DeleteCharacterRequest {
  characterId: string
}

export interface DeleteCharacterResponse {
  success: boolean
}

export interface GetUserCharactersResponse {
  characters: CharacterSnapshot[]
}

// Re-use bootstrapSession for user state
export const getUserState = async (): Promise<BootstrapResponse> => {
  return await bootstrapSession()
}

export const updateUserProfile =
  updateUserProfileCallable as Callable<UpdateUserProfileRequest, UpdateUserProfileResponse>

export const acceptTermsFn =
  acceptTermsCallable as Callable<AcceptTermsRequest, AcceptTermsResponse>

export const syncCharacterFn =
  syncCharacterCallable as Callable<SyncCharacterRequest, CharacterSnapshot>
export const deleteCharacterFn =
  deleteCharacterCallable as Callable<DeleteCharacterRequest, DeleteCharacterResponse>
export const getUserCharactersFn =
  getUserCharactersCallable as OptionalCallable<void, GetUserCharactersResponse>
