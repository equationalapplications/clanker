import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { userRepository } from './services/userRepository.js';
import { characterService } from './services/characterService.js';

export const syncCharacter = onCall(
  {
    region: 'us-central1',
    enforceAppCheck: true,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }

    const { character } = request.data as { character: any };
    if (!character || !character.id) {
      throw new HttpsError('invalid-argument', 'Valid character data is required.');
    }

    const user = await userRepository.findUserByFirebaseUid(request.auth.uid);
    if (!user) {
      throw new HttpsError('not-found', 'User not found.');
    }

    try {
      const upserted = await characterService.upsertCharacter({
        id: character.id,
        userId: user.id,
        name: character.name,
        avatar: character.avatar,
        appearance: character.appearance,
        traits: character.traits,
        emotions: character.emotions,
        context: character.context,
        isPublic: character.isPublic,
        createdAt: new Date(character.createdAt || Date.now()),
        updatedAt: new Date(character.updatedAt || Date.now()),
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
