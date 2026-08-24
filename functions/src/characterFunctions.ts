import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https'
import * as logger from 'firebase-functions/logger'
import { userRepository } from './services/userRepository.js'
import { characterService, CharacterOwnershipError } from './services/characterService.js'
import { creditService, type CreditSpendAllocation } from './services/creditService.js'
import { characterImageService, IMAGE_CAP_PER_CHARACTER } from './services/characterImageService.js'
import { storageAdmin } from './services/storageAdmin.js'
import { CLOUD_SQL_SECRETS } from './cloudSqlSecrets.js'
import { DEFAULT_VOICE } from './constants/voiceDefaults.js'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type SyncCharacterPayload = {
  id?: string
  name: string
  appearance?: string | null
  traits?: string | null
  emotions?: string | null
  context?: string | null
  voice?: string | null
  isPublic?: boolean
  createdAt?: string
  updatedAt?: string
}

type CharacterFunctionDeps = {
  userRepository: Pick<typeof userRepository, 'findUserByFirebaseUid'>
  characterService: Pick<
    typeof characterService,
    | 'upsertCharacter'
    | 'deleteCharacter'
    | 'getUserCharacters'
    | 'getPublicCharacterWithOwner'
    | 'assertCharacterOwnership'
    | 'isOwnedByUser'
  >
  creditService: Pick<typeof creditService, 'spendCredits' | 'refundCredit'>
  characterImageService: Pick<
    typeof characterImageService,
    | 'syncImages'
    | 'deleteImages'
    | 'listImages'
    | 'listImagesByCharacters'
    | 'setActiveImage'
    | 'purgeCharacter'
  >
  storageAdmin: Pick<typeof storageAdmin, 'createSignedUrl' | 'deletePrefix' | 'deleteObjects'>
}

function toISO(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  if (typeof value === 'string') {
    return value
  }

  throw new Error(`Invalid timestamp value type: ${typeof value}`)
}

function serializeCharacter(character: Record<string, unknown>, ownerFirebaseUid: string) {
  // ownerUserId is the OWNER'S Firebase UID (matches client `auth.currentUser.uid`).
  // The internal `character.userId` is the Cloud SQL `users.id` UUID and must NOT
  // be exposed as ownership identity, since clients compare against Firebase uid.
  const { userId: _internalUserId, ...rest } = character
  void _internalUserId
  return {
    ...rest,
    createdAt: toISO(character.createdAt),
    updatedAt: toISO(character.updatedAt),
    ownerUserId: ownerFirebaseUid,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseOptionalTextField(
  value: unknown,
  field: 'appearance' | 'traits' | 'emotions' | 'context' | 'voice',
): string | null | undefined {
  if (value === undefined || value === null) {
    return value
  }

  if (typeof value !== 'string') {
    throw new HttpsError(
      'invalid-argument',
      `character.${field} must be a string or null when provided.`,
    )
  }

  return value
}

function parseOptionalIsPublic(value: unknown): boolean | undefined {
  if (value === undefined) {
    return undefined
  }

  if (typeof value !== 'boolean') {
    throw new HttpsError('invalid-argument', 'character.isPublic must be a boolean when provided.')
  }

  return value
}

type CharacterImagePayload = {
  id: string
  storagePath: string
  thumbPath?: string | null
  mimeType?: string | null
  source: string
  messageId: string | null
}

const IMAGE_SOURCES = new Set(['generated', 'uploaded', 'imported', 'chat'])

// Must stay in sync with storage.rules, which admits only these two at upload
// time. The value is persisted and echoed back to every device, where it drives
// data-URI construction — an unvalidated `text/html` or `image/svg+xml` row
// would be a stored XSS primitive on web.
const IMAGE_MIME_TYPES = new Set(['image/webp', 'image/jpeg'])

// The server-authoritative FIFO cap bounds surviving rows, not write volume per
// request. A little slack above the cap absorbs a device that legitimately has a
// full gallery plus in-flight additions.
const MAX_IMAGES_PER_SYNC_REQUEST = IMAGE_CAP_PER_CHARACTER + 20

function serializeCharacterImage(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    characterId: String(row.characterId),
    storagePath: String(row.storagePath),
    thumbPath: row.thumbPath == null ? null : String(row.thumbPath),
    mimeType: String(row.mimeType ?? 'image/webp'),
    source: String(row.source),
    messageId: row.messageId == null ? null : String(row.messageId),
    createdAt: toISO(row.createdAt),
    deletedAt: toISO(row.deletedAt),
  }
}

/**
 * Validate one client-supplied image row.
 *
 * The storagePath check is the security boundary: the client chooses the path,
 * so the server must confirm it lands inside the caller's own tree. Without it a
 * caller could register a row pointing at another user's objects and have the
 * eviction path delete them.
 */
function parseImagePayload(
  value: unknown,
  firebaseUid: string,
  characterId: string,
): CharacterImagePayload {
  if (!isRecord(value)) {
    throw new HttpsError('invalid-argument', 'Each image must be an object.')
  }

  const { id, storagePath, thumbPath, mimeType, source, messageId } = value as Record<
    string,
    unknown
  >

  if (typeof id !== 'string' || !UUID_REGEX.test(id)) {
    throw new HttpsError('invalid-argument', 'image.id must be a UUID.')
  }
  if (typeof storagePath !== 'string' || storagePath.length === 0) {
    throw new HttpsError('invalid-argument', 'image.storagePath is required.')
  }
  if (typeof source !== 'string' || !IMAGE_SOURCES.has(source)) {
    throw new HttpsError(
      'invalid-argument',
      'image.source must be generated, uploaded, imported, or chat.',
    )
  }
  // Rejected rather than silently coerced to null: a caller that sent a
  // malformed thumbPath believes it registered a thumb, and dropping it here
  // would leave the server (and every other device) without one while the
  // sender never learns its request was only partially honoured.
  if (thumbPath !== undefined && thumbPath !== null && typeof thumbPath !== 'string') {
    throw new HttpsError(
      'invalid-argument',
      'image.thumbPath must be a string or null when provided.',
    )
  }
  // Same argument as thumbPath: a caller that sent a malformed messageId
  // believes the photo is linked to its message, and silently nulling it
  // strands the bubble on every other device.
  if (messageId !== undefined && messageId !== null && typeof messageId !== 'string') {
    throw new HttpsError(
      'invalid-argument',
      'image.messageId must be a string or null when provided.',
    )
  }

  const expectedPrefix = `users/${firebaseUid}/characters/${characterId}/`
  const paths = [storagePath, ...(typeof thumbPath === 'string' ? [thumbPath] : [])]
  for (const path of paths) {
    if (!path.startsWith(expectedPrefix) || path.includes('..')) {
      throw new HttpsError(
        'permission-denied',
        "Image paths must live under the caller's own character prefix.",
      )
    }
  }

  if (mimeType != null && (typeof mimeType !== 'string' || !IMAGE_MIME_TYPES.has(mimeType))) {
    throw new HttpsError('invalid-argument', 'image.mimeType must be image/webp or image/jpeg.')
  }

  return {
    id,
    storagePath,
    thumbPath: typeof thumbPath === 'string' ? thumbPath : null,
    mimeType: typeof mimeType === 'string' ? mimeType : 'image/webp',
    source,
    messageId: typeof messageId === 'string' ? messageId : null,
  }
}

export const syncCharacterImages = onCall(
  {
    region: 'us-central1',
    enforceAppCheck: true,
    invoker: 'public',
    secrets: [...CLOUD_SQL_SECRETS],
  },
  (request) => syncCharacterImagesHandler(request),
)

export const syncCharacterImagesHandler = async (
  request: CallableRequest,
  deps: CharacterFunctionDeps = {
    userRepository,
    characterService,
    creditService,
    characterImageService,
    storageAdmin,
  },
) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required.')
  }
  if (!isRecord(request.data)) {
    throw new HttpsError('invalid-argument', 'characterId is required.')
  }

  const { characterId, images, deletedImageIds, activeImageId } = request.data as {
    characterId?: unknown
    images?: unknown
    deletedImageIds?: unknown
    activeImageId?: unknown
  }

  if (typeof characterId !== 'string' || !UUID_REGEX.test(characterId)) {
    throw new HttpsError('invalid-argument', 'characterId must be a valid UUID.')
  }

  const user = await deps.userRepository.findUserByFirebaseUid(request.auth.uid)
  if (!user) {
    throw new HttpsError('not-found', 'User not found.')
  }

  // Ownership is checked directly against this one id rather than trusting the
  // caller: images are the only payload that carries storage paths, and a
  // mis-scoped one is destructive (eviction deletes objects).
  const owned = await deps.characterService.isOwnedByUser(characterId, user.id)
  if (!owned) {
    throw new HttpsError('permission-denied', 'Character does not belong to authenticated user.')
  }

  if (Array.isArray(images) && images.length > MAX_IMAGES_PER_SYNC_REQUEST) {
    throw new HttpsError(
      'invalid-argument',
      `images may contain at most ${MAX_IMAGES_PER_SYNC_REQUEST} entries.`,
    )
  }
  if (Array.isArray(deletedImageIds) && deletedImageIds.length > MAX_IMAGES_PER_SYNC_REQUEST) {
    throw new HttpsError(
      'invalid-argument',
      `deletedImageIds may contain at most ${MAX_IMAGES_PER_SYNC_REQUEST} entries.`,
    )
  }

  const parsedImages = Array.isArray(images)
    ? images.map((image) => parseImagePayload(image, request.auth!.uid, characterId))
    : []

  // Same argument as activeImageId: silently dropping a malformed id would
  // leave that image live on the server while the sending device believes its
  // deletion was registered, and stop retrying it.
  if (Array.isArray(deletedImageIds)) {
    for (const id of deletedImageIds) {
      if (typeof id !== 'string' || !UUID_REGEX.test(id)) {
        throw new HttpsError('invalid-argument', 'deletedImageIds must each be a UUID.')
      }
    }
  }
  const parsedDeletions: string[] = Array.isArray(deletedImageIds) ? deletedImageIds : []

  try {
    if (parsedDeletions.length > 0) {
      await deps.characterImageService.deleteImages(characterId, user.id, parsedDeletions)
    }

    const { evictedImageIds } = await deps.characterImageService.syncImages(
      characterId,
      user.id,
      parsedImages.map((image) => ({
        id: image.id,
        characterId,
        userId: user.id,
        storagePath: image.storagePath,
        thumbPath: image.thumbPath ?? null,
        mimeType: image.mimeType ?? 'image/webp',
        source: image.source,
        messageId: image.messageId ?? null,
      })),
    )

    const rows = await deps.characterImageService.listImages(characterId)

    // `undefined` means "no change"; an explicit `null` clears the pointer, which
    // is what a device sends after deleting the last image. Anything else that is
    // not a live UUID is rejected rather than dropped — silently ignoring it would
    // leave the server pointer stale while the device believes it synced.
    if (activeImageId === null) {
      await deps.characterImageService.setActiveImage(characterId, null)
    } else if (activeImageId !== undefined) {
      if (typeof activeImageId !== 'string' || !UUID_REGEX.test(activeImageId)) {
        throw new HttpsError('invalid-argument', 'activeImageId must be a UUID or null.')
      }
      const ownsActiveImage = rows.some(
        (row) =>
          String((row as { id: unknown }).id) === activeImageId &&
          (row as { deletedAt: unknown }).deletedAt == null,
      )
      if (!ownsActiveImage) {
        throw new HttpsError(
          'permission-denied',
          'activeImageId must reference a live image belonging to this character.',
        )
      }
      await deps.characterImageService.setActiveImage(characterId, activeImageId)
    }

    return {
      evictedImageIds,
      images: rows.map((row) => serializeCharacterImage(row as unknown as Record<string, unknown>)),
    }
  } catch (error) {
    if (error instanceof HttpsError) throw error
    logger.error('Failed to sync character images', { error, characterId })
    throw new HttpsError('internal', 'Failed to sync character images.')
  }
}

export const syncCharacter = onCall(
  {
    region: 'us-central1',
    enforceAppCheck: true,
    invoker: 'public',
    secrets: [...CLOUD_SQL_SECRETS],
  },
  (request) => syncCharacterHandler(request),
)

export const syncCharacterHandler = async (
  request: CallableRequest,
  deps: CharacterFunctionDeps = {
    userRepository,
    characterService,
    creditService,
    characterImageService,
    storageAdmin,
  },
) => {
  const actualDeps: CharacterFunctionDeps = {
    ...{ userRepository, characterService, creditService },
    ...deps,
  }

  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required.')
  }

  if (!isRecord(request.data)) {
    throw new HttpsError('invalid-argument', 'Valid character data is required.')
  }

  const { character } = request.data as { character?: SyncCharacterPayload }
  if (!character || typeof character !== 'object' || Array.isArray(character)) {
    throw new HttpsError('invalid-argument', 'Valid character data is required.')
  }

  if (character.id && !UUID_REGEX.test(character.id)) {
    throw new HttpsError('invalid-argument', 'character.id must be a UUID when provided.')
  }

  if (!character.name || typeof character.name !== 'string' || character.name.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'character.name must be a non-empty string.')
  }

  const appearance = parseOptionalTextField(character.appearance, 'appearance')
  const traits = parseOptionalTextField(character.traits, 'traits')
  const emotions = parseOptionalTextField(character.emotions, 'emotions')
  const context = parseOptionalTextField(character.context, 'context')
  const voice = Object.prototype.hasOwnProperty.call(character, 'voice')
    ? (() => {
        const parsedVoice = parseOptionalTextField(character.voice, 'voice')
        if (parsedVoice == null) {
          return DEFAULT_VOICE
        }

        const normalizedVoice = parsedVoice.trim()
        return normalizedVoice.length === 0 ? DEFAULT_VOICE : normalizedVoice
      })()
    : undefined
  const isPublic = parseOptionalIsPublic(character.isPublic)

  const user = await actualDeps.userRepository.findUserByFirebaseUid(request.auth.uid)
  if (!user) {
    throw new HttpsError('not-found', 'User not found.')
  }

  let spendAllocations: CreditSpendAllocation[] | null = null
  try {
    spendAllocations = await actualDeps.creditService.spendCredits(
      user.id,
      100,
      'character_generate',
    )
    if (spendAllocations === null) {
      throw new HttpsError('failed-precondition', 'Insufficient credits.')
    }

    const upserted = await actualDeps.characterService.upsertCharacter(
      {
        ...(character.id ? { id: character.id } : {}),
        userId: user.id,
        name: character.name,
        appearance,
        traits,
        emotions,
        context,
        voice,
        isPublic,
        saveToCloud: true,
        createdAt: undefined,
        updatedAt: undefined,
      },
      user.id,
    )

    return serializeCharacter(upserted as unknown as Record<string, unknown>, request.auth.uid)
  } catch (error) {
    if (spendAllocations) {
      try {
        await actualDeps.creditService.refundCredit(user.id, spendAllocations)
      } catch (refundError) {
        logger.error('Failed to refund credits after syncCharacter failure', {
          userId: user.id,
          spendAllocations,
          error: refundError,
        })
      }
    }

    if (error instanceof HttpsError) {
      throw error
    }

    if (error instanceof CharacterOwnershipError) {
      throw new HttpsError('permission-denied', 'Character does not belong to authenticated user.')
    }

    logger.error('Failed to sync character', { error })
    throw new HttpsError('internal', 'Failed to sync character.')
  }
}

export const deleteCharacter = onCall(
  {
    region: 'us-central1',
    enforceAppCheck: true,
    invoker: 'public',
    secrets: [...CLOUD_SQL_SECRETS],
  },
  (request) => deleteCharacterHandler(request),
)

export const deleteCharacterHandler = async (
  request: CallableRequest,
  deps: CharacterFunctionDeps = {
    userRepository,
    characterService,
    creditService,
    characterImageService,
    storageAdmin,
  },
) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required.')
  }

  if (!isRecord(request.data)) {
    throw new HttpsError('invalid-argument', 'Character ID is required.')
  }

  const { characterId } = request.data as { characterId?: unknown }
  if (typeof characterId !== 'string' || characterId.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'Character ID is required.')
  }

  const normalizedCharacterId = characterId.trim()
  if (!UUID_REGEX.test(normalizedCharacterId)) {
    throw new HttpsError('invalid-argument', 'characterId must be a valid UUID.')
  }

  const user = await deps.userRepository.findUserByFirebaseUid(request.auth.uid)
  if (!user) {
    throw new HttpsError('not-found', 'User not found.')
  }

  try {
    // Ownership first: purgeCharacter's Storage prefix is keyed on the caller's
    // own uid, so it silently no-ops on a foreign characterId — it cannot be
    // trusted to reject one. Without this check, a caller-supplied UUID for
    // another user's character would delete that user's cloud image rows
    // (deleteByCharacter is additionally scoped by user_id, but asserting
    // here rejects the request before any destructive step runs at all).
    await deps.characterService.assertCharacterOwnership(normalizedCharacterId, user.id)

    // Images first: the parent character row is about to disappear, so the
    // tombstones would have nothing left to reconcile against. Prefix deletion
    // is a list-then-delete loop — idempotent, so a partial failure is safe to
    // re-run — and it is the only place the objects can be reached from, since
    // the client may be offline or the rows may belong to another device.
    await deps.characterImageService.purgeCharacter(
      request.auth.uid,
      user.id,
      normalizedCharacterId,
    )
    await deps.characterService.deleteCharacter(normalizedCharacterId, user.id)
    return { success: true }
  } catch (error) {
    if (error instanceof HttpsError) {
      throw error
    }

    if (error instanceof CharacterOwnershipError) {
      throw new HttpsError('permission-denied', 'Character does not belong to authenticated user.')
    }

    logger.error('Failed to delete character', { error })
    throw new HttpsError('internal', 'Failed to delete character.')
  }
}

export const getUserCharacters = onCall(
  {
    region: 'us-central1',
    enforceAppCheck: true,
    invoker: 'public',
    secrets: [...CLOUD_SQL_SECRETS],
  },
  (request) => getUserCharactersHandler(request),
)

export const getUserCharactersHandler = async (
  request: CallableRequest,
  deps: CharacterFunctionDeps = {
    userRepository,
    characterService,
    creditService,
    characterImageService,
    storageAdmin,
  },
) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required.')
  }

  const user = await deps.userRepository.findUserByFirebaseUid(request.auth.uid)
  if (!user) {
    throw new HttpsError('not-found', 'User not found.')
  }

  try {
    const characters = await deps.characterService.getUserCharacters(user.id)
    const characterIds = characters.map((character) => String((character as { id: unknown }).id))
    const allImages = await deps.characterImageService.listImagesByCharacters(characterIds)
    const imagesByCharacter = new Map<string, Record<string, unknown>[]>()
    for (const row of allImages) {
      const record = row as unknown as Record<string, unknown>
      const key = String(record.characterId)
      const bucket = imagesByCharacter.get(key) ?? []
      bucket.push(serializeCharacterImage(record))
      imagesByCharacter.set(key, bucket)
    }

    const withImages = characters.map((character) => {
      const record = character as unknown as Record<string, unknown>
      return {
        ...serializeCharacter(record, request.auth!.uid),
        activeImageId: record.activeImageId ?? null,
        // Tombstones are included deliberately: a client cannot distinguish a
        // truncated response from a genuine remote delete, so absence must
        // never mean "delete it locally".
        images: imagesByCharacter.get(String(record.id)) ?? [],
      }
    })
    return { characters: withImages }
  } catch (error) {
    logger.error('Failed to get user characters', { error })
    throw new HttpsError('internal', 'Failed to get user characters.')
  }
}

export const getPublicCharacter = onCall(
  {
    region: 'us-central1',
    enforceAppCheck: true,
    invoker: 'public',
    secrets: [...CLOUD_SQL_SECRETS],
  },
  (request) => getPublicCharacterHandler(request),
)

export const getPublicCharacterHandler = async (
  request: CallableRequest,
  deps: CharacterFunctionDeps = {
    userRepository,
    characterService,
    creditService,
    characterImageService,
    storageAdmin,
  },
) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required.')
  }

  if (!isRecord(request.data)) {
    throw new HttpsError('invalid-argument', 'characterId is required.')
  }

  const { characterId } = request.data as { characterId?: unknown }
  if (typeof characterId !== 'string' || characterId.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'characterId is required.')
  }

  const normalizedCharacterId = characterId.trim()
  if (!UUID_REGEX.test(normalizedCharacterId)) {
    throw new HttpsError('invalid-argument', 'characterId must be a valid UUID.')
  }

  const user = await deps.userRepository.findUserByFirebaseUid(request.auth.uid)
  if (!user) {
    throw new HttpsError('not-found', 'User not found.')
  }

  try {
    const row = await deps.characterService.getPublicCharacterWithOwner(normalizedCharacterId)
    if (!row) {
      throw new HttpsError('not-found', 'Public character not found.')
    }

    const character = row.character as unknown as Record<string, unknown>
    const activeImageId = character.activeImageId ? String(character.activeImageId) : null

    let avatarSignedUrl: string | null = null
    if (activeImageId) {
      // The avatar is a nice-to-have; the character itself is the payload, so
      // this whole block (listing the images, not just signing the URL) must
      // never turn into an import-wide failure. A transient images-table blip
      // is exactly the same class of non-fatal problem as a signBlob IAM error.
      try {
        const images = await deps.characterImageService.listImages(normalizedCharacterId)
        const active = images.find(
          (image) =>
            String((image as { id: unknown }).id) === activeImageId &&
            !(image as { deletedAt: unknown }).deletedAt,
        )
        if (active) {
          // 15 minutes: long enough for the importer to download once, short
          // enough that a leaked link is worthless. Sharing never grants
          // object-level read — the storage rules have no public path.
          avatarSignedUrl = await deps.storageAdmin.createSignedUrl(
            String((active as { storagePath: unknown }).storagePath),
          )
        }
      } catch (error) {
        // Most commonly this is the IAM trap: the runtime service account
        // needs roles/iam.serviceAccountTokenCreator on itself.
        logger.error('Failed to resolve public character avatar URL', {
          error,
          characterId: normalizedCharacterId,
        })
      }
    }

    return {
      ...serializeCharacter(character, row.ownerFirebaseUid),
      avatarSignedUrl,
    }
  } catch (error) {
    if (error instanceof HttpsError) {
      throw error
    }
    logger.error('Failed to get public character', { error, characterId: normalizedCharacterId })
    throw new HttpsError('internal', 'Failed to get public character.')
  }
}
