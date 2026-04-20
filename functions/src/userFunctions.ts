import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { userRepository } from './services/userRepository.js';
import { subscriptionService } from './services/subscriptionService.js';
import { CLOUD_SQL_SECRETS } from './cloudSqlSecrets.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_DISPLAY_NAME_LENGTH = 100;
const MAX_AVATAR_URL_LENGTH = 2048;

type UpdateUserProfilePayload = {
  displayName?: string | null;
  avatarUrl?: string | null;
  isProfilePublic?: boolean;
  defaultCharacterId?: string | null;
};

type UserFunctionDeps = {
  userRepository: Pick<typeof userRepository, 'findUserByFirebaseUid' | 'updateUser'>;
  subscriptionService: Pick<typeof subscriptionService, 'acceptTerms'>;
};

function toISO(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  return value instanceof Date ? value.toISOString() : (value as string);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseTermsVersion(data: unknown): string {
  if (!isRecord(data)) {
    throw new HttpsError('invalid-argument', 'Terms version is required.');
  }

  const { termsVersion } = data;
  if (typeof termsVersion !== 'string' || termsVersion.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'Terms version is required.');
  }

  return termsVersion.trim();
}

function normalizeOptionalStringField(
  value: unknown,
  fieldName: string,
  maxLength: number
): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value !== 'string') {
    throw new HttpsError('invalid-argument', `${fieldName} must be a string, null, or undefined.`);
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  if (trimmed.length > maxLength) {
    throw new HttpsError('invalid-argument', `${fieldName} exceeds maximum length of ${maxLength}.`);
  }

  return trimmed;
}

function validateUpdateUserProfilePayload(data: unknown): UpdateUserProfilePayload {
  if (data === undefined) {
    return {};
  }

  if (!isRecord(data)) {
    throw new HttpsError('invalid-argument', 'request.data must be an object.');
  }

  const allowedKeys: Array<keyof UpdateUserProfilePayload> = [
    'displayName',
    'avatarUrl',
    'isProfilePublic',
    'defaultCharacterId',
  ];

  const unknownKeys = Object.keys(data).filter((key) => !allowedKeys.includes(key as keyof UpdateUserProfilePayload));
  if (unknownKeys.length > 0) {
    throw new HttpsError('invalid-argument', `Unknown field(s): ${unknownKeys.join(', ')}`);
  }

  const payload: UpdateUserProfilePayload = {};

  payload.displayName = normalizeOptionalStringField(
    data.displayName,
    'displayName',
    MAX_DISPLAY_NAME_LENGTH
  );

  payload.avatarUrl = normalizeOptionalStringField(
    data.avatarUrl,
    'avatarUrl',
    MAX_AVATAR_URL_LENGTH
  );

  if (data.isProfilePublic !== undefined) {
    if (typeof data.isProfilePublic !== 'boolean') {
      throw new HttpsError('invalid-argument', 'isProfilePublic must be a boolean when provided.');
    }

    payload.isProfilePublic = data.isProfilePublic;
  }

  if (data.defaultCharacterId !== undefined) {
    if (data.defaultCharacterId === null) {
      payload.defaultCharacterId = null;
    } else if (typeof data.defaultCharacterId === 'string') {
      const trimmed = data.defaultCharacterId.trim();

      if (trimmed.length === 0) {
        payload.defaultCharacterId = null;
      } else if (!UUID_REGEX.test(trimmed)) {
        throw new HttpsError('invalid-argument', 'defaultCharacterId must be a valid UUID when provided.');
      } else {
        payload.defaultCharacterId = trimmed;
      }
    } else {
      throw new HttpsError('invalid-argument', 'defaultCharacterId must be a string, null, or undefined.');
    }
  }

  return payload;
}

export const updateUserProfile = onCall(
  {
    region: 'us-central1',
    enforceAppCheck: true,
    invoker: 'public',
    secrets: [...CLOUD_SQL_SECRETS],
  },
  (request) => updateUserProfileHandler(request)
);

export const updateUserProfileHandler = async (
  request: CallableRequest,
  deps: UserFunctionDeps = { userRepository, subscriptionService }
) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required.');
  }

  const { displayName, avatarUrl, isProfilePublic, defaultCharacterId } =
    validateUpdateUserProfilePayload(request.data);

  const user = await deps.userRepository.findUserByFirebaseUid(request.auth.uid);
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
    const updatedUser = await deps.userRepository.updateUser(user.id, updates);
    if (!updatedUser) {
      throw new HttpsError('not-found', 'User not found.');
    }

    return {
      ...updatedUser,
      createdAt: toISO(updatedUser.createdAt),
      updatedAt: toISO(updatedUser.updatedAt),
    };
  } catch (error) {
    if (error instanceof HttpsError) {
      throw error;
    }
    logger.error('Failed to update user profile', { error });
    throw new HttpsError('internal', 'Failed to update user profile.');
  }
};

export const acceptTerms = onCall(
  {
    region: 'us-central1',
    enforceAppCheck: true,
    invoker: 'public',
    secrets: [...CLOUD_SQL_SECRETS],
  },
  (request) => acceptTermsHandler(request)
);

export const acceptTermsHandler = async (
  request: CallableRequest,
  deps: UserFunctionDeps = { userRepository, subscriptionService }
) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required.');
  }

  const termsVersion = parseTermsVersion(request.data);

  const user = await deps.userRepository.findUserByFirebaseUid(request.auth.uid);
  if (!user) {
    throw new HttpsError('not-found', 'User not found.');
  }

  try {
    await deps.subscriptionService.acceptTerms(user.id, termsVersion, new Date());
    return { success: true };
  } catch (error) {
    logger.error('Failed to accept terms', { error });
    throw new HttpsError('internal', 'Failed to accept terms.');
  }
};
