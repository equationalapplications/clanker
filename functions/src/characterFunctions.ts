import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { userRepository } from './services/userRepository.js';
import { characterService, CharacterOwnershipError } from './services/characterService.js';
import { creditService, type CreditSpendAllocation } from './services/creditService.js';
import { characterImageService } from './services/characterImageService.js';
import { CLOUD_SQL_SECRETS } from './cloudSqlSecrets.js';
import { DEFAULT_VOICE } from './constants/voiceDefaults.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type SyncCharacterPayload = {
  id?: string;
  name: string;
  avatar?: string | null;
  appearance?: string | null;
  traits?: string | null;
  emotions?: string | null;
  context?: string | null;
  voice?: string | null;
  isPublic?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

type CharacterFunctionDeps = {
  userRepository: Pick<typeof userRepository, 'findUserByFirebaseUid'>;
  characterService: Pick<
    typeof characterService,
    'upsertCharacter' | 'deleteCharacter' | 'getUserCharacters' | 'getPublicCharacterWithOwner'
  >;
  creditService: Pick<typeof creditService, 'spendCredits' | 'refundCredit'>;
  characterImageService: Pick<
    typeof characterImageService,
    'syncImages' | 'deleteImages' | 'listImages' | 'setActiveImage'
  >;
};


function toISO(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'string') {
    return value;
  }

  throw new Error(`Invalid timestamp value type: ${typeof value}`);
}

function serializeCharacter(
  character: Record<string, unknown>,
  ownerFirebaseUid: string
) {
  // ownerUserId is the OWNER'S Firebase UID (matches client `auth.currentUser.uid`).
  // The internal `character.userId` is the Cloud SQL `users.id` UUID and must NOT
  // be exposed as ownership identity, since clients compare against Firebase uid.
  const { userId: _internalUserId, ...rest } = character;
  void _internalUserId;
  return {
    ...rest,
    createdAt: toISO(character.createdAt),
    updatedAt: toISO(character.updatedAt),
    ownerUserId: ownerFirebaseUid,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseOptionalTextField(
  value: unknown,
  field: 'avatar' | 'appearance' | 'traits' | 'emotions' | 'context' | 'voice'
): string | null | undefined {
  if (value === undefined || value === null) {
    return value;
  }

  if (typeof value !== 'string') {
    throw new HttpsError('invalid-argument', `character.${field} must be a string or null when provided.`);
  }

  return value;
}

function parseOptionalIsPublic(value: unknown): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'boolean') {
    throw new HttpsError('invalid-argument', 'character.isPublic must be a boolean when provided.');
  }

  return value;
}

type CharacterImagePayload = {
  id: string;
  storagePath: string;
  thumbPath?: string | null;
  mimeType?: string | null;
  source: string;
  createdAt?: string;
};

const IMAGE_SOURCES = new Set(['generated', 'uploaded', 'imported']);

function serializeCharacterImage(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    characterId: String(row.characterId),
    storagePath: String(row.storagePath),
    thumbPath: row.thumbPath == null ? null : String(row.thumbPath),
    mimeType: String(row.mimeType ?? 'image/webp'),
    source: String(row.source),
    createdAt: toISO(row.createdAt),
    deletedAt: toISO(row.deletedAt),
  };
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
  characterId: string
): CharacterImagePayload {
  if (!isRecord(value)) {
    throw new HttpsError('invalid-argument', 'Each image must be an object.');
  }

  const {id, storagePath, thumbPath, mimeType, source} = value as Record<string, unknown>;

  if (typeof id !== 'string' || !UUID_REGEX.test(id)) {
    throw new HttpsError('invalid-argument', 'image.id must be a UUID.');
  }
  if (typeof storagePath !== 'string' || storagePath.length === 0) {
    throw new HttpsError('invalid-argument', 'image.storagePath is required.');
  }
  if (typeof source !== 'string' || !IMAGE_SOURCES.has(source)) {
    throw new HttpsError('invalid-argument', 'image.source must be generated, uploaded, or imported.');
  }

  const expectedPrefix = `users/${firebaseUid}/characters/${characterId}/`;
  const paths = [storagePath, ...(typeof thumbPath === 'string' ? [thumbPath] : [])];
  for (const path of paths) {
    if (!path.startsWith(expectedPrefix) || path.includes('..')) {
      throw new HttpsError('permission-denied', 'Image paths must live under the caller\'s own character prefix.');
    }
  }

  return {
    id,
    storagePath,
    thumbPath: typeof thumbPath === 'string' ? thumbPath : null,
    mimeType: typeof mimeType === 'string' ? mimeType : 'image/webp',
    source,
  };
}

export const syncCharacterImages = onCall(
  {
    region: 'us-central1',
    enforceAppCheck: true,
    invoker: 'public',
    secrets: [...CLOUD_SQL_SECRETS],
  },
  (request) => syncCharacterImagesHandler(request)
);

export const syncCharacterImagesHandler = async (
  request: CallableRequest,
  deps: CharacterFunctionDeps = {userRepository, characterService, creditService, characterImageService}
) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required.');
  }
  if (!isRecord(request.data)) {
    throw new HttpsError('invalid-argument', 'characterId is required.');
  }

  const {characterId, images, deletedImageIds, activeImageId} = request.data as {
    characterId?: unknown;
    images?: unknown;
    deletedImageIds?: unknown;
    activeImageId?: unknown;
  };

  if (typeof characterId !== 'string' || !UUID_REGEX.test(characterId)) {
    throw new HttpsError('invalid-argument', 'characterId must be a valid UUID.');
  }

  const user = await deps.userRepository.findUserByFirebaseUid(request.auth.uid);
  if (!user) {
    throw new HttpsError('not-found', 'User not found.');
  }

  // Ownership is checked against the caller's own character set rather than by
  // trusting the id: images are the only payload that carries storage paths, and
  // a mis-scoped one is destructive (eviction deletes objects).
  const owned = await deps.characterService.getUserCharacters(user.id);
  if (!owned.some((character) => String((character as {id: unknown}).id) === characterId)) {
    throw new HttpsError('permission-denied', 'Character does not belong to authenticated user.');
  }

  const parsedImages = Array.isArray(images)
    ? images.map((image) => parseImagePayload(image, request.auth!.uid, characterId))
    : [];

  const parsedDeletions = Array.isArray(deletedImageIds)
    ? deletedImageIds.filter((id): id is string => typeof id === 'string' && UUID_REGEX.test(id))
    : [];

  try {
    if (parsedDeletions.length > 0) {
      await deps.characterImageService.deleteImages(characterId, user.id, parsedDeletions);
    }

    const {evictedImageIds} = await deps.characterImageService.syncImages(
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
      }))
    );

    if (typeof activeImageId === 'string' && UUID_REGEX.test(activeImageId)) {
      await deps.characterImageService.setActiveImage(characterId, activeImageId);
    }

    const rows = await deps.characterImageService.listImages(characterId);
    return {
      evictedImageIds,
      images: rows.map((row) => serializeCharacterImage(row as unknown as Record<string, unknown>)),
    };
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    logger.error('Failed to sync character images', {error, characterId});
    throw new HttpsError('internal', 'Failed to sync character images.');
  }
};

export const syncCharacter = onCall(
  {
    region: 'us-central1',
    enforceAppCheck: true,
    invoker: 'public',
    secrets: [...CLOUD_SQL_SECRETS],
  },
  (request) => syncCharacterHandler(request)
);

export const syncCharacterHandler = async (
  request: CallableRequest,
  deps: CharacterFunctionDeps = { userRepository, characterService, creditService, characterImageService }
) => {
  const actualDeps: CharacterFunctionDeps = {
    ...{userRepository, characterService, creditService},
    ...deps,
  };

  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required.');
  }

  if (!isRecord(request.data)) {
    throw new HttpsError('invalid-argument', 'Valid character data is required.');
  }

  const { character } = request.data as { character?: SyncCharacterPayload };
  if (!character || typeof character !== 'object' || Array.isArray(character)) {
    throw new HttpsError('invalid-argument', 'Valid character data is required.');
  }

  if (character.id && !UUID_REGEX.test(character.id)) {
    throw new HttpsError('invalid-argument', 'character.id must be a UUID when provided.');
  }

  if (!character.name || typeof character.name !== 'string' || character.name.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'character.name must be a non-empty string.');
  }

  const avatar = parseOptionalTextField(character.avatar, 'avatar');
  const appearance = parseOptionalTextField(character.appearance, 'appearance');
  const traits = parseOptionalTextField(character.traits, 'traits');
  const emotions = parseOptionalTextField(character.emotions, 'emotions');
  const context = parseOptionalTextField(character.context, 'context');
  const voice = Object.prototype.hasOwnProperty.call(character, 'voice')
    ? (() => {
        const parsedVoice = parseOptionalTextField(character.voice, 'voice');
        if (parsedVoice == null) {
          return DEFAULT_VOICE;
        }

        const normalizedVoice = parsedVoice.trim();
        return normalizedVoice.length === 0 ? DEFAULT_VOICE : normalizedVoice;
      })()
    : undefined;
  const isPublic = parseOptionalIsPublic(character.isPublic);

  const user = await actualDeps.userRepository.findUserByFirebaseUid(request.auth.uid);
  if (!user) {
    throw new HttpsError('not-found', 'User not found.');
  }

  let spendAllocations: CreditSpendAllocation[] | null = null;
  try {
    spendAllocations = await actualDeps.creditService.spendCredits(user.id, 100);
    if (spendAllocations === null) {
      throw new HttpsError('failed-precondition', 'Insufficient credits.');
    }

    const upserted = await actualDeps.characterService.upsertCharacter({
      ...(character.id ? { id: character.id } : {}),
      userId: user.id,
      name: character.name,
      avatar,
      appearance,
      traits,
      emotions,
      context,
      voice,
      isPublic,
      saveToCloud: true,
      createdAt: undefined,
      updatedAt: undefined,
    }, user.id);

    return serializeCharacter(upserted as unknown as Record<string, unknown>, request.auth.uid);
  } catch (error) {
    if (spendAllocations) {
      try {
        await actualDeps.creditService.refundCredit(user.id, spendAllocations);
      } catch (refundError) {
        logger.error('Failed to refund credits after syncCharacter failure', {
          userId: user.id,
          spendAllocations,
          error: refundError,
        });
      }
    }

    if (error instanceof HttpsError) {
      throw error;
    }

    if (error instanceof CharacterOwnershipError) {
      throw new HttpsError(
        'permission-denied',
        'Character does not belong to authenticated user.'
      );
    }

    logger.error('Failed to sync character', { error });
    throw new HttpsError('internal', 'Failed to sync character.');
  }
};

export const deleteCharacter = onCall(
  {
    region: 'us-central1',
    enforceAppCheck: true,
    invoker: 'public',
    secrets: [...CLOUD_SQL_SECRETS],
  },
  (request) => deleteCharacterHandler(request)
);

export const deleteCharacterHandler = async (
  request: CallableRequest,
  deps: CharacterFunctionDeps = { userRepository, characterService, creditService, characterImageService }
) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required.');
  }

  if (!isRecord(request.data)) {
    throw new HttpsError('invalid-argument', 'Character ID is required.');
  }

  const { characterId } = request.data as { characterId?: unknown };
  if (typeof characterId !== 'string' || characterId.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'Character ID is required.');
  }

  const normalizedCharacterId = characterId.trim();
  if (!UUID_REGEX.test(normalizedCharacterId)) {
    throw new HttpsError('invalid-argument', 'characterId must be a valid UUID.');
  }

  const user = await deps.userRepository.findUserByFirebaseUid(request.auth.uid);
  if (!user) {
    throw new HttpsError('not-found', 'User not found.');
  }

  try {
    await deps.characterService.deleteCharacter(normalizedCharacterId, user.id);
    return { success: true };
  } catch (error) {
    if (error instanceof HttpsError) {
      throw error;
    }

    if (error instanceof CharacterOwnershipError) {
      throw new HttpsError(
        'permission-denied',
        'Character does not belong to authenticated user.'
      );
    }

    logger.error('Failed to delete character', { error });
    throw new HttpsError('internal', 'Failed to delete character.');
  }
};

export const getUserCharacters = onCall(
  {
    region: 'us-central1',
    enforceAppCheck: true,
    invoker: 'public',
    secrets: [...CLOUD_SQL_SECRETS],
  },
  (request) => getUserCharactersHandler(request)
);

export const getUserCharactersHandler = async (
  request: CallableRequest,
  deps: CharacterFunctionDeps = { userRepository, characterService, creditService, characterImageService }
) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required.');
  }

  const user = await deps.userRepository.findUserByFirebaseUid(request.auth.uid);
  if (!user) {
    throw new HttpsError('not-found', 'User not found.');
  }

  try {
    const characters = await deps.characterService.getUserCharacters(user.id);
    const withImages = await Promise.all(
      characters.map(async (character) => {
        const record = character as unknown as Record<string, unknown>;
        const rows = await deps.characterImageService.listImages(String(record.id));
        return {
          ...serializeCharacter(record, request.auth!.uid),
          activeImageId: record.activeImageId ?? null,
          // Tombstones are included deliberately: a client cannot distinguish a
          // truncated response from a genuine remote delete, so absence must
          // never mean "delete it locally".
          images: rows.map((row) => serializeCharacterImage(row as unknown as Record<string, unknown>)),
        };
      })
    );
    return {characters: withImages};
  } catch (error) {
    logger.error('Failed to get user characters', { error });
    throw new HttpsError('internal', 'Failed to get user characters.');
  }
};

export const getPublicCharacter = onCall(
  {
    region: 'us-central1',
    enforceAppCheck: true,
    invoker: 'public',
    secrets: [...CLOUD_SQL_SECRETS],
  },
  (request) => getPublicCharacterHandler(request)
);

export const getPublicCharacterHandler = async (
  request: CallableRequest,
  deps: CharacterFunctionDeps = { userRepository, characterService, creditService, characterImageService }
) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required.');
  }

  if (!isRecord(request.data)) {
    throw new HttpsError('invalid-argument', 'characterId is required.');
  }

  const { characterId } = request.data as { characterId?: unknown };
  if (typeof characterId !== 'string' || characterId.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'characterId is required.');
  }

  const normalizedCharacterId = characterId.trim();
  if (!UUID_REGEX.test(normalizedCharacterId)) {
    throw new HttpsError('invalid-argument', 'characterId must be a valid UUID.');
  }

  const user = await deps.userRepository.findUserByFirebaseUid(request.auth.uid);
  if (!user) {
    throw new HttpsError('not-found', 'User not found.');
  }

  try {
    const row = await deps.characterService.getPublicCharacterWithOwner(normalizedCharacterId);
    if (!row) {
      throw new HttpsError('not-found', 'Public character not found.');
    }
    return serializeCharacter(
      row.character as unknown as Record<string, unknown>,
      row.ownerFirebaseUid
    );
  } catch (error) {
    if (error instanceof HttpsError) {
      throw error;
    }
    logger.error('Failed to get public character', { error, characterId: normalizedCharacterId });
    throw new HttpsError('internal', 'Failed to get public character.');
  }
};
