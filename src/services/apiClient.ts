import type { BootstrapResponse, UserSnapshot } from '~/auth/bootstrapSession'
import { bootstrapSession } from '~/auth/bootstrapSession'
import {
  appCheckReady,
  acceptTermsFn as acceptTermsCallable,
  deleteCharacterFn as deleteCharacterCallable,
  getPublicCharacterFn as getPublicCharacterCallable,
  getUserCharactersFn as getUserCharactersCallable,
  syncCharacterFn as syncCharacterCallable,
  updateUserProfileFn as updateUserProfileCallable,
} from '~/config/firebaseConfig'

type Callable<Req, Res> = (payload: Req) => Promise<{ data: Res }>
type OptionalCallable<Req, Res> = (payload?: Req) => Promise<{ data: Res }>

const withAppCheck = <Req, Res>(callable: Callable<Req, Res>): Callable<Req, Res> => {
  return async (payload: Req) => {
    await appCheckReady
    return callable(payload)
  }
}

const withAppCheckOptional = <Req, Res>(
  callable: OptionalCallable<Req, Res>,
): OptionalCallable<Req, Res> => {
  return async (payload?: Req) => {
    await appCheckReady
    return callable(payload)
  }
}

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
  voice?: string | null
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
  voice?: string | null
  isPublic: boolean
  createdAt: string
  updatedAt: string
  ownerUserId: string
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

export interface GetPublicCharacterRequest {
  characterId: string
}

// bootstrapSession handles module-level in-flight dedupe across all callers.
export const getUserState = async (): Promise<BootstrapResponse> => bootstrapSession()

export const updateUserProfile = withAppCheck(
  updateUserProfileCallable as Callable<UpdateUserProfileRequest, UpdateUserProfileResponse>,
)

export const acceptTermsFn = withAppCheck(
  acceptTermsCallable as Callable<AcceptTermsRequest, AcceptTermsResponse>,
)

export const syncCharacterFn = withAppCheck(
  syncCharacterCallable as Callable<SyncCharacterRequest, CharacterSnapshot>,
)
export const deleteCharacterFn = withAppCheck(
  deleteCharacterCallable as Callable<DeleteCharacterRequest, DeleteCharacterResponse>,
)
export const getUserCharactersFn = withAppCheckOptional(
  getUserCharactersCallable as OptionalCallable<void, GetUserCharactersResponse>,
)

export const getPublicCharacterFn = withAppCheck(
  getPublicCharacterCallable as Callable<GetPublicCharacterRequest, CharacterSnapshot>,
)
