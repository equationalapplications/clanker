import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import type { DecodedIdToken } from 'firebase-admin/auth';

import { CLOUD_SQL_SECRETS } from './cloudSqlSecrets.js';
import { userRepository } from './services/userRepository.js';
import { subscriptionService } from './services/subscriptionService.js';

const DEFAULT_REGION = 'us-central1';
const PREMIUM_TIERS = new Set(['monthly_20', 'monthly_50']);

type PlanStatus = 'active' | 'cancelled' | 'expired';

type MemoryFunctionDeps = {
  userRepository: Pick<typeof userRepository, 'getOrCreateUserByFirebaseIdentity'>;
  subscriptionService: Pick<typeof subscriptionService, 'getSubscription' | 'getOrCreateDefaultSubscription'>;
};

type MemoryIdentity = {
  userId: string;
  hasUnlimited: boolean;
};

type MemoryReadPayload = {
  characterId?: unknown;
  query?: unknown;
};

type MemoryWritePayload = {
  characterId?: unknown;
  sourceText?: unknown;
};

type MemoryForgetPayload = {
  characterId?: unknown;
  entryIds?: unknown;
  taskIds?: unknown;
  clearAll?: unknown;
};

const defaultDeps: MemoryFunctionDeps = {
  userRepository,
  subscriptionService,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizePlanStatus(status: string | null | undefined): PlanStatus {
  if (status === 'active' || status === 'cancelled' || status === 'expired') {
    return status;
  }

  return 'expired';
}

function parseCharacterId(data: unknown): string {
  if (!isRecord(data)) {
    throw new HttpsError('invalid-argument', 'characterId must be a non-empty string.');
  }

  const value = data.characterId;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'characterId must be a non-empty string.');
  }

  return value.trim();
}

function parseOptionalQuery(data: unknown): string {
  if (!isRecord(data)) {
    return '';
  }

  const value = data.query;
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim();
}

function parseSourceText(data: unknown): string {
  if (!isRecord(data)) {
    throw new HttpsError('invalid-argument', 'sourceText must be a non-empty string.');
  }

  const value = data.sourceText;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'sourceText must be a non-empty string.');
  }

  return value.trim();
}

function parseStringIdList(value: unknown, field: 'entryIds' | 'taskIds'): string[] {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new HttpsError('invalid-argument', `${field} must be an array of strings when provided.`);
  }

  const parsed = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  if (parsed.length !== value.length) {
    throw new HttpsError('invalid-argument', `${field} must contain only non-empty strings.`);
  }

  return parsed;
}

function parseForgetTargets(data: unknown): { entryIds: string[]; taskIds: string[]; clearAll: boolean } {
  if (!isRecord(data)) {
    throw new HttpsError('invalid-argument', 'Valid forget payload is required.');
  }

  const entryIds = parseStringIdList(data.entryIds, 'entryIds');
  const taskIds = parseStringIdList(data.taskIds, 'taskIds');
  const clearAll = data.clearAll === true;

  if (data.clearAll !== undefined && typeof data.clearAll !== 'boolean') {
    throw new HttpsError('invalid-argument', 'clearAll must be a boolean when provided.');
  }

  if (!clearAll && entryIds.length === 0 && taskIds.length === 0) {
    throw new HttpsError('invalid-argument', 'At least one forget target is required.');
  }

  return { entryIds, taskIds, clearAll };
}

async function authenticateAndResolveIdentity(
  request: CallableRequest,
  deps: MemoryFunctionDeps,
): Promise<MemoryIdentity> {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required.');
  }

  const decoded: DecodedIdToken = request.auth.token as DecodedIdToken;
  if (!decoded || decoded.uid !== request.auth.uid) {
    throw new HttpsError('unauthenticated', 'Invalid Firebase authentication token.');
  }

  const email = typeof decoded.email === 'string' ? decoded.email.trim() : '';
  if (!email) {
    throw new HttpsError('failed-precondition', 'Firebase user email is required.');
  }

  const user = await deps.userRepository.getOrCreateUserByFirebaseIdentity({
    firebaseUid: request.auth.uid,
    email,
    displayName: decoded.name || null,
    avatarUrl: decoded.picture || null,
  });

  const existing = await deps.subscriptionService.getSubscription(user.id);
  const subscription = existing ?? await deps.subscriptionService.getOrCreateDefaultSubscription(user.id);
  const planStatus = normalizePlanStatus(subscription.planStatus);
  const hasUnlimited = planStatus === 'active' && PREMIUM_TIERS.has(subscription.planTier);

  return {
    userId: user.id,
    hasUnlimited,
  };
}

function buildEmptyReadResponse(characterId: string, query: string) {
  return {
    characterId,
    query,
    entries: [] as Array<Record<string, never>>,
    tasks: [] as Array<Record<string, never>>,
    events: [] as Array<Record<string, never>>,
    synonyms: [] as Array<Record<string, never>>,
  };
}

function buildEmptyWriteDiff() {
  return {
    entriesAdded: 0,
    entriesUpdated: 0,
    tasksOpened: 0,
    tasksClosed: 0,
    eventsAppended: 0,
    synonymsUpdated: 0,
    entries: [] as Array<Record<string, never>>,
    tasks: [] as Array<Record<string, never>>,
    events: [] as Array<Record<string, never>>,
    synonyms: [] as Array<Record<string, never>>,
  };
}

function buildEmptyHealDiff() {
  return {
    contradictionsFlagged: 0,
    staleDowngraded: 0,
    orphansRemoved: 0,
    conceptsSeeded: 0,
    entries: [] as Array<Record<string, never>>,
    tasks: [] as Array<Record<string, never>>,
    events: [] as Array<Record<string, never>>,
  };
}

export const memoryReadHandler = async (
  request: CallableRequest,
  deps: MemoryFunctionDeps = defaultDeps,
) => {
  const identity = await authenticateAndResolveIdentity(request, deps);
  void identity.userId;

  const payload = request.data as MemoryReadPayload;
  const characterId = parseCharacterId(payload);
  const query = parseOptionalQuery(payload);

  if (!identity.hasUnlimited) {
    throw new HttpsError('permission-denied', 'Memory read is available only for unlimited plans.');
  }

  return buildEmptyReadResponse(characterId, query);
};

export const memoryWriteHandler = async (
  request: CallableRequest,
  deps: MemoryFunctionDeps = defaultDeps,
) => {
  const identity = await authenticateAndResolveIdentity(request, deps);
  const payload = request.data as MemoryWritePayload;

  parseCharacterId(payload);
  parseSourceText(payload);
  void identity.userId;

  if (!identity.hasUnlimited) {
    throw new HttpsError('permission-denied', 'Memory write is available only for unlimited plans.');
  }

  return {
    diff: buildEmptyWriteDiff(),
  };
};

export const memoryHealHandler = async (
  request: CallableRequest,
  deps: MemoryFunctionDeps = defaultDeps,
) => {
  const identity = await authenticateAndResolveIdentity(request, deps);
  parseCharacterId(request.data);
  void identity.userId;

  // Heal path is intentionally fail-soft when premium access is missing.
  if (!identity.hasUnlimited) {
    return {
      diff: buildEmptyHealDiff(),
    };
  }

  return {
    diff: buildEmptyHealDiff(),
  };
};

export const memoryForgetHandler = async (
  request: CallableRequest,
  deps: MemoryFunctionDeps = defaultDeps,
) => {
  const identity = await authenticateAndResolveIdentity(request, deps);
  const payload = request.data as MemoryForgetPayload;

  parseCharacterId(payload);
  const targets = parseForgetTargets(payload);
  void identity.userId;

  if (!identity.hasUnlimited) {
    throw new HttpsError('permission-denied', 'Memory forget is available only for unlimited plans.');
  }

  return {
    success: true,
    deleted: {
      entries: targets.clearAll ? 0 : targets.entryIds.length,
      tasks: targets.clearAll ? 0 : targets.taskIds.length,
    },
  };
};

export const syncCharacterMemoryHandler = async (
  request: CallableRequest,
  deps: MemoryFunctionDeps = defaultDeps,
) => {
  const identity = await authenticateAndResolveIdentity(request, deps);
  parseCharacterId(request.data);
  void identity.userId;

  if (!identity.hasUnlimited) {
    return {
      syncedEntries: 0,
      syncedTasks: 0,
      syncedEvents: 0,
    };
  }

  return {
    syncedEntries: 0,
    syncedTasks: 0,
    syncedEvents: 0,
  };
};

export const memoryRead = onCall(
  {
    region: DEFAULT_REGION,
    enforceAppCheck: true,
    invoker: 'public',
    secrets: [...CLOUD_SQL_SECRETS],
  },
  (request) => memoryReadHandler(request),
);

export const memoryWrite = onCall(
  {
    region: DEFAULT_REGION,
    enforceAppCheck: true,
    invoker: 'public',
    secrets: [...CLOUD_SQL_SECRETS],
  },
  (request) => memoryWriteHandler(request),
);

export const memoryHeal = onCall(
  {
    region: DEFAULT_REGION,
    enforceAppCheck: true,
    invoker: 'public',
    secrets: [...CLOUD_SQL_SECRETS],
  },
  (request) => memoryHealHandler(request),
);

export const memoryForget = onCall(
  {
    region: DEFAULT_REGION,
    enforceAppCheck: true,
    invoker: 'public',
    secrets: [...CLOUD_SQL_SECRETS],
  },
  (request) => memoryForgetHandler(request),
);

export const syncCharacterMemory = onCall(
  {
    region: DEFAULT_REGION,
    enforceAppCheck: true,
    invoker: 'public',
    secrets: [...CLOUD_SQL_SECRETS],
  },
  (request) => syncCharacterMemoryHandler(request),
);