import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { userRepository } from './services/userRepository.js';
import { characterService } from './services/characterService.js';

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

export const syncCharacter = onCall(
  {
    region: 'us-central1',
    enforceAppCheck: true,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }

    const { character } = request.data as { character: SyncCharacterPayload };
    if (!character) {
      throw new HttpsError('invalid-argument', 'Valid character data is required.');
    }

    if (character.id && !UUID_REGEX.test(character.id)) {
      throw new HttpsError('invalid-argument', 'character.id must be a UUID when provided.');
    }

    const user = await userRepository.findUserByFirebaseUid(request.auth.uid);
    if (!user) {
      throw new HttpsError('not-found', 'User not found.');
    }

    try {
      const createdAt = parseOptionalTimestamp(character.createdAt, 'createdAt');
      const updatedAt = parseOptionalTimestamp(character.updatedAt, 'updatedAt');

      const upserted = await characterService.upsertCharacter({
        ...(character.id ? { id: character.id } : {}),
        userId: user.id,
        name: character.name,
        avatar: character.avatar,
        appearance: character.appearance,
        traits: character.traits,
        emotions: character.emotions,
        context: character.context,
        isPublic: character.isPublic,
        createdAt,
        updatedAt,
      });
      return upserted;
    } catch (error) {
      logger.error('Failed to sync character', { error });
      throw new HttpsError('internal', 'Failed to sync character.');
    }
  }
);

export const deleteCharacter = onCall(
  {
    region: 'us-central1',
    enforceAppCheck: true,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }

    const { characterId } = request.data as { characterId: string };
    if (!characterId) {
      throw new HttpsError('invalid-argument', 'Character ID is required.');
    }

    if (!UUID_REGEX.test(characterId)) {
      throw new HttpsError('invalid-argument', 'characterId must be a valid UUID.');
    }

    const user = await userRepository.findUserByFirebaseUid(request.auth.uid);
    if (!user) {
      throw new HttpsError('not-found', 'User not found.');
    }

    try {
      await characterService.deleteCharacter(characterId, user.id);
      return { success: true };
    } catch (error) {
      logger.error('Failed to delete character', { error });
      throw new HttpsError('internal', 'Failed to delete character.');
    }
  }
);

export const getUserCharacters = onCall(
  {
    region: 'us-central1',
    enforceAppCheck: true,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }

    const user = await userRepository.findUserByFirebaseUid(request.auth.uid);
    if (!user) {
      throw new HttpsError('not-found', 'User not found.');
    }

    try {
      const characters = await characterService.getUserCharacters(user.id);
      return { characters };
    } catch (error) {
      logger.error('Failed to get user characters', { error });
      throw new HttpsError('internal', 'Failed to get user characters.');
    }
  }
);
