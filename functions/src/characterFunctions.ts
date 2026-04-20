import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { userRepository } from './services/userRepository.js';
import { characterService } from './services/characterService.js';
import { CLOUD_SQL_SECRETS } from './cloudSqlSecrets.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type SyncCharacterPayload = {
  id?: string;
  name: string;
  avatar?: string | null;
  appearance?: string | null;
  traits?: string | null;
  emotions?: string | null;
  context?: string | null;
  isPublic?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

type CharacterFunctionDeps = {
  userRepository: Pick<typeof userRepository, 'findUserByFirebaseUid'>;
  characterService: Pick<typeof characterService, 'upsertCharacter' | 'deleteCharacter' | 'getUserCharacters'>;
};

function toISO(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  return value instanceof Date ? value.toISOString() : (value as string);
}

function serializeCharacter(character: Record<string, unknown>) {
  return {
    ...character,
    createdAt: toISO(character.createdAt),
    updatedAt: toISO(character.updatedAt),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseOptionalTimestamp(value: string | undefined, field: 'createdAt' | 'updatedAt'): Date | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new HttpsError('invalid-argument', `${field} must be a valid timestamp when provided.`);
  }

  return parsed;
}

function parseOptionalTextField(
  value: unknown,
  field: 'avatar' | 'appearance' | 'traits' | 'emotions' | 'context'
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
  deps: CharacterFunctionDeps = { userRepository, characterService }
) => {
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

  const createdAt = parseOptionalTimestamp(character.createdAt, 'createdAt');
  const updatedAt = parseOptionalTimestamp(character.updatedAt, 'updatedAt');
  const avatar = parseOptionalTextField(character.avatar, 'avatar');
  const appearance = parseOptionalTextField(character.appearance, 'appearance');
  const traits = parseOptionalTextField(character.traits, 'traits');
  const emotions = parseOptionalTextField(character.emotions, 'emotions');
  const context = parseOptionalTextField(character.context, 'context');
  const isPublic = parseOptionalIsPublic(character.isPublic);

  const user = await deps.userRepository.findUserByFirebaseUid(request.auth.uid);
  if (!user) {
    throw new HttpsError('not-found', 'User not found.');
  }

  try {
    const upserted = await deps.characterService.upsertCharacter({
      ...(character.id ? { id: character.id } : {}),
      userId: user.id,
      name: character.name,
      avatar,
      appearance,
      traits,
      emotions,
      context,
      isPublic,
      createdAt,
      updatedAt,
    }, user.id);

    return serializeCharacter(upserted as unknown as Record<string, unknown>);
  } catch (error) {
    if (error instanceof HttpsError) {
      throw error;
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
  deps: CharacterFunctionDeps = { userRepository, characterService }
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
  deps: CharacterFunctionDeps = { userRepository, characterService }
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
    return {
      characters: characters.map((character) =>
        serializeCharacter(character as unknown as Record<string, unknown>)
      ),
    };
  } catch (error) {
    logger.error('Failed to get user characters', { error });
    throw new HttpsError('internal', 'Failed to get user characters.');
  }
};
