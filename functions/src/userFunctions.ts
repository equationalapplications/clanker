import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { userRepository } from './services/userRepository.js';
import { subscriptionService } from './services/subscriptionService.js';

export const updateUserProfile = onCall(
  {
    region: 'us-central1',
    enforceAppCheck: true,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }

    const { displayName, avatarUrl, isProfilePublic, defaultCharacterId } = request.data as {
      displayName?: string | null;
      avatarUrl?: string | null;
      isProfilePublic?: boolean;
      defaultCharacterId?: string | null;
    };

    const user = await userRepository.findUserByFirebaseUid(request.auth.uid);
    if (!user) {
      throw new HttpsError('not-found', 'User not found.');
    }

    const updates: Partial<{
      displayName: string | null;
      avatarUrl: string | null;
      isProfilePublic: boolean;
      defaultCharacterId: string | null;
    }> = {};
    if (displayName !== undefined) updates.displayName = displayName;
    if (avatarUrl !== undefined) updates.avatarUrl = avatarUrl;
    if (isProfilePublic !== undefined) updates.isProfilePublic = isProfilePublic;
    if (defaultCharacterId !== undefined) updates.defaultCharacterId = defaultCharacterId;

    try {
      const updatedUser = await userRepository.updateUser(user.id, updates);
      return updatedUser;
    } catch (error) {
      logger.error('Failed to update user profile', { error });
      throw new HttpsError('internal', 'Failed to update user profile.');
    }
  }
);

export const acceptTerms = onCall(
  {
    region: 'us-central1',
    enforceAppCheck: true,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }

    const { termsVersion } = request.data as { termsVersion: string };
    if (!termsVersion) {
      throw new HttpsError('invalid-argument', 'Terms version is required.');
    }

    const user = await userRepository.findUserByFirebaseUid(request.auth.uid);
    if (!user) {
      throw new HttpsError('not-found', 'User not found.');
    }

    try {
      await subscriptionService.acceptTerms(user.id, termsVersion, new Date());
      return { success: true };
    } catch (error) {
      logger.error('Failed to accept terms', { error });
      throw new HttpsError('internal', 'Failed to accept terms.');
    }
  }
);
