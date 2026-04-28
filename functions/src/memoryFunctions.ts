import * as logger from 'firebase-functions/logger';
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { DecodedIdToken } from 'firebase-admin/auth';

import { CLOUD_SQL_SECRETS } from './cloudSqlSecrets.js';
import { PREMIUM_TIERS } from './constants/plans.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
import { userRepository } from './services/userRepository.js';
import { subscriptionService } from './services/subscriptionService.js';
import { getDb } from './db/cloudSql.js';
import { agentTasks, characters, memoryEvents, wikiEntries } from './db/schema.js';

const DEFAULT_REGION = 'us-central1';
const HEAL_MODEL = 'gemini-2.5-flash';
const HEAL_MAX_OUTPUT_TOKENS = 1_024;

type PlanStatus = 'active' | 'cancelled' | 'expired';

type MemoryIdentity = {
  userId: string;
  firebaseUid: string;
  hasUnlimited: boolean;
};

type MemoryReadPayload = {
  characterId?: unknown;
  query?: unknown;
};

type MemoryWritePayload = {
  characterId?: unknown;
  sourceText?: unknown;
  sourceType?: unknown;
};

type MemoryForgetPayload = {
  characterId?: unknown;
  entryIds?: unknown;
  taskIds?: unknown;
  clearAll?: unknown;
  sourceRef?: unknown;
  sourceHash?: unknown;
};

type MemoryWriteEntry = {
  id: string;
  characterId: string;
  userId: string;
  title: string;
  body: string;
  tags: string[];
  confidence: 'certain' | 'inferred' | 'tentative';
  sourceType: 'user_stated' | 'agent_inferred' | 'user_confirmed' | 'user_document';
  createdAt: number;
  updatedAt: number;
  lastAccessedAt: number | null;
  accessCount: number;
  syncedToCloud: number;
  cloudId: string | null;
  deletedAt: number | null;
};

type MemoryWriteTask = {
  id: string;
  characterId: string;
  userId: string;
  description: string;
  status: 'pending' | 'in_progress' | 'done' | 'abandoned';
  priority: number;
  dueContext: string | null;
  createdAt: number;
  updatedAt: number;
  resolvedAt: number | null;
  resolutionNote: string | null;
  syncedToCloud: number;
  cloudId: string | null;
  deletedAt: number | null;
};

type MemoryWriteEvent = {
  id: string;
  characterId: string;
  userId: string;
  eventType: 'observation' | 'decision' | 'action' | 'outcome';
  summary: string;
  relatedEntryId: string | null;
  relatedTaskId: string | null;
  sourceRef: string | null;
  createdAt: number;
  syncedToCloud: number;
  cloudId: string | null;
};

type MemoryWriteSynonym = {
  term: string;
  synonyms: string[];
  updatedAt: number;
};

type MemoryWriteDiff = {
  entriesAdded: number;
  entriesUpdated: number;
  tasksOpened: number;
  tasksClosed: number;
  eventsAppended: number;
  synonymsUpdated: number;
  entries: MemoryWriteEntry[];
  tasks: MemoryWriteTask[];
  events: MemoryWriteEvent[];
  synonyms: MemoryWriteSynonym[];
};

type MemoryHealDiff = {
  contradictionsFlagged: number;
  staleDowngraded: number;
  orphansRemoved: number;
  conceptsSeeded: number;
  entries: MemoryWriteEntry[];
  tasks: MemoryWriteTask[];
  events: MemoryWriteEvent[];
};

type MemoryFunctionDeps = {
  userRepository: Pick<typeof userRepository, 'getOrCreateUserByFirebaseIdentity'>;
  subscriptionService: Pick<typeof subscriptionService, 'getSubscription' | 'getOrCreateDefaultSubscription'>;
  getDb: typeof getDb;
  generateContent: (prompt: string) => Promise<string>;
};

interface VertexGenerativeModel {
  generateContent(prompt: string): Promise<{ response: { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> } }>;
}
interface VertexAILike {
  getGenerativeModel(config: { model: string; generationConfig: { maxOutputTokens: number } }): VertexGenerativeModel;
}
interface VertexAIModule {
  VertexAI: new (config: { project: string; location: string }) => VertexAILike;
}

let healModelPromise: Promise<VertexGenerativeModel> | undefined;

async function getHealModel(): Promise<VertexGenerativeModel> {
  if (healModelPromise) return healModelPromise;
  const project = (process.env.GCLOUD_PROJECT ?? process.env.GCP_PROJECT)?.trim();
  if (!project) {
    throw new HttpsError('failed-precondition', 'Missing GCLOUD_PROJECT for memory heal.');
  }
  healModelPromise = (async () => {
    try {
      const mod = await import('@google-cloud/vertexai') as VertexAIModule;
      const vertex = new mod.VertexAI({ project, location: DEFAULT_REGION });
      return vertex.getGenerativeModel({
        model: HEAL_MODEL,
        generationConfig: { maxOutputTokens: HEAL_MAX_OUTPUT_TOKENS },
      });
    } catch (err: unknown) {
      healModelPromise = undefined;
      throw err;
    }
  })();
  return healModelPromise;
}

async function defaultGenerateContent(prompt: string): Promise<string> {
  const model = await getHealModel();
  const result = await model.generateContent(prompt);
  const text = result.response.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  return text;
}

const defaultDeps: MemoryFunctionDeps = {
  userRepository,
  subscriptionService,
  getDb,
  generateContent: defaultGenerateContent,
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

function parseSourceType(data: unknown): 'conversation' | 'user_document' {
  if (!isRecord(data)) {
    return 'conversation';
  }

  const value = data.sourceType;
  if (value === 'user_document') {
    return 'user_document';
  }

  return 'conversation';
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

function parseForgetTargets(data: unknown): {
  entryIds: string[];
  taskIds: string[];
  clearAll: boolean;
  sourceRef: string | null;
  sourceHash: string | null;
} {
  if (!isRecord(data)) {
    throw new HttpsError('invalid-argument', 'Valid forget payload is required.');
  }

  const entryIds = parseStringIdList(data.entryIds, 'entryIds');
  const taskIds = parseStringIdList(data.taskIds, 'taskIds');
  const clearAll = data.clearAll === true;

  if (data.clearAll !== undefined && typeof data.clearAll !== 'boolean') {
    throw new HttpsError('invalid-argument', 'clearAll must be a boolean when provided.');
  }

  // Parse sourceRef: sanitize and limit to 255 chars
  let sourceRef: string | null = null;
  if (data.sourceRef !== undefined) {
    if (typeof data.sourceRef !== 'string') {
      throw new HttpsError('invalid-argument', 'sourceRef must be a string when provided.');
    }
    const cleaned = data.sourceRef
      .replace(/[/\\]/g, '')
      .split('\0').join('')
      .trim()
      .slice(0, 255);
    sourceRef = cleaned.length > 0 ? cleaned : null;
  }

  // Parse sourceHash: must be a 64-char hex SHA-256 string
  let sourceHash: string | null = null;
  if (data.sourceHash !== undefined) {
    if (typeof data.sourceHash !== 'string' || !/^[0-9a-f]{64}$/i.test(data.sourceHash)) {
      throw new HttpsError('invalid-argument', 'sourceHash must be a 64-character hex SHA-256 string.');
    }
    sourceHash = data.sourceHash.toLowerCase();
  }

  if (!clearAll && entryIds.length === 0 && taskIds.length === 0 && sourceRef === null && sourceHash === null) {
    throw new HttpsError('invalid-argument', 'At least one forget target is required.');
  }

  return { entryIds, taskIds, clearAll, sourceRef, sourceHash };
}

function clip(value: string, maxLength: number): string {
  const normalized = value.trim();
  return normalized.length <= maxLength ? normalized : normalized.slice(0, maxLength).trimEnd();
}

function stableId(prefix: string, characterId: string, key: string): string {
  let h = 5381;
  const str = `${characterId}\x00${key}`;
  for (let i = 0; i < str.length; i++) {
    h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
  }
  return `${prefix}_${h.toString(36)}`;
}

function inferPriority(summary: string): number {
  const lowered = summary.toLowerCase();
  if (lowered.includes('urgent') || lowered.includes('asap') || lowered.includes('today')) {
    return 2;
  }

  if (lowered.includes('later') || lowered.includes('someday') || lowered.includes('eventually')) {
    return -1;
  }

  return 0;
}

function inferTags(summary: string): string[] {
  const lowered = summary.toLowerCase();
  const tags: string[] = [];

  if (lowered.includes('health') || lowered.includes('workout') || lowered.includes('run')) {
    tags.push('health');
  }
  if (lowered.includes('work') || lowered.includes('job') || lowered.includes('deadline')) {
    tags.push('work');
  }
  if (lowered.includes('partner') || lowered.includes('friend') || lowered.includes('family')) {
    tags.push('relationships');
  }
  if (lowered.includes('goal') || lowered.includes('plan') || lowered.includes('next')) {
    tags.push('goals');
  }

  return tags.slice(0, 3);
}

function isTaskSentence(input: string): boolean {
  return /\b(remind|follow up|check in|ask|todo|next)\b/i.test(input);
}

function fromDate(value: Date | null): number | null {
  return value ? value.getTime() : null;
}

function toDate(value: number | null | undefined): Date | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  return new Date(value);
}

function normalizeTerms(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((value) => value.trim())
    .filter((value) => value.length >= 3)
    .slice(0, 6);
}

function buildSynonyms(entries: MemoryWriteEntry[]): MemoryWriteSynonym[] {
  const termsByTag = new Map<string, string[]>();

  for (const entry of entries) {
    const titleTerms = normalizeTerms(entry.title);
    for (const tag of entry.tags) {
      const existing = termsByTag.get(tag) ?? [];
      existing.push(...titleTerms);
      termsByTag.set(tag, existing);
    }
  }

  const now = Date.now();
  const rows: MemoryWriteSynonym[] = [];

  for (const [term, values] of termsByTag.entries()) {
    const counts = new Map<string, number>();
    for (const value of values) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }

    const synonyms = Array.from(counts.entries())
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .map(([value]) => value)
      .slice(0, 5);

    if (synonyms.length > 0) {
      rows.push({ term, synonyms, updatedAt: now });
    }
  }

  return rows;
}

function parseLocalDumpEntries(
  characterId: string,
  userId: string,
  raw: unknown,
): MemoryWriteEntry[] {
  if (!Array.isArray(raw)) return [];
  const now = Date.now();
  return raw
    .filter(isRecord)
    .slice(0, 100)
    .map((item): MemoryWriteEntry | null => {
      const id = typeof item['id'] === 'string' && item['id'].trim().length > 0 ? item['id'].trim() : null;
      const title = typeof item['title'] === 'string' ? clip(item['title'], 128) : null;
      const body = typeof item['body'] === 'string' ? clip(item['body'], 200) : null;
      if (!id || !title || !body) return null;

      const tags: string[] = Array.isArray(item['tags'])
        ? (item['tags'] as unknown[]).filter((t): t is string => typeof t === 'string').slice(0, 20)
        : [];
      const confidence: MemoryWriteEntry['confidence'] =
        item['confidence'] === 'certain' || item['confidence'] === 'tentative' ? item['confidence'] : 'inferred';
      const sourceType: MemoryWriteEntry['sourceType'] =
        item['sourceType'] === 'user_stated' || item['sourceType'] === 'user_confirmed' || item['sourceType'] === 'user_document'
          ? item['sourceType']
          : 'agent_inferred';
      const createdAt = typeof item['createdAt'] === 'number' ? item['createdAt'] : now;
      const updatedAt = typeof item['updatedAt'] === 'number' ? item['updatedAt'] : now;
      const lastAccessedAt = typeof item['lastAccessedAt'] === 'number' ? item['lastAccessedAt'] : null;
      const accessCount = typeof item['accessCount'] === 'number' ? Math.max(0, Math.floor(item['accessCount'])) : 0;
      const deletedAt = typeof item['deletedAt'] === 'number' ? item['deletedAt'] : null;

      return {
        id,
        characterId,
        userId,
        title,
        body,
        tags,
        confidence,
        sourceType,
        createdAt,
        updatedAt,
        lastAccessedAt,
        accessCount,
        syncedToCloud: 0,
        cloudId: null,
        deletedAt,
      };
    })
    .filter((e): e is MemoryWriteEntry => e !== null);
}

function parseLocalDumpTasks(
  characterId: string,
  userId: string,
  raw: unknown,
): MemoryWriteTask[] {
  if (!Array.isArray(raw)) return [];
  const now = Date.now();
  return raw
    .filter(isRecord)
    .slice(0, 20)
    .map((item): MemoryWriteTask | null => {
      const id = typeof item['id'] === 'string' && item['id'].trim().length > 0 ? item['id'].trim() : null;
      const description = typeof item['description'] === 'string' ? clip(item['description'], 200) : null;
      if (!id || !description) return null;
      const priority = typeof item['priority'] === 'number' ? Math.floor(item['priority']) : 0;
      return {
        id,
        characterId,
        userId,
        description,
        status: 'pending',
        priority,
        dueContext: null,
        createdAt: now,
        updatedAt: now,
        resolvedAt: null,
        resolutionNote: null,
        syncedToCloud: 0,
        cloudId: null,
        deletedAt: null,
      };
    })
    .filter((t): t is MemoryWriteTask => t !== null);
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
  const subscription = existing ?? (await deps.subscriptionService.getOrCreateDefaultSubscription(user.id));
  const planStatus = normalizePlanStatus(subscription.planStatus);
  const hasUnlimited = planStatus === 'active' && PREMIUM_TIERS.has(subscription.planTier);

  return {
    userId: user.id,
    firebaseUid: request.auth.uid,
    hasUnlimited,
  };
}

async function hasOwnedCloudCharacter(
  deps: MemoryFunctionDeps,
  characterId: string,
  userId: string,
): Promise<boolean> {
  if (!UUID_RE.test(characterId)) {
    return false;
  }

  const db = await deps.getDb();
  const row = await db
    .select({ id: characters.id })
    .from(characters)
    .where(and(eq(characters.id, characterId), eq(characters.userId, userId)))
    .limit(1);

  return Boolean(row[0]?.id);
}

function buildEmptyReadResponse(characterId: string, query: string) {
  return {
    characterId,
    query,
    entries: [] as MemoryWriteEntry[],
    tasks: [] as MemoryWriteTask[],
    events: [] as MemoryWriteEvent[],
    synonyms: [] as MemoryWriteSynonym[],
  };
}

function buildEmptyHealDiff(): MemoryHealDiff {
  return {
    contradictionsFlagged: 0,
    staleDowngraded: 0,
    orphansRemoved: 0,
    conceptsSeeded: 0,
    entries: [],
    tasks: [],
    events: [],
  };
}

function mapCloudEntry(row: typeof wikiEntries.$inferSelect, firebaseUid: string): MemoryWriteEntry {
  return {
    id: row.id,
    characterId: row.characterId,
    userId: firebaseUid,
    title: row.title,
    body: row.body,
    tags: Array.isArray(row.tags) ? (row.tags.filter((value): value is string => typeof value === 'string')) : [],
    confidence: row.confidence as MemoryWriteEntry['confidence'],
    sourceType: row.sourceType as MemoryWriteEntry['sourceType'],
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
    lastAccessedAt: fromDate(row.lastAccessedAt),
    accessCount: row.accessCount,
    syncedToCloud: 1,
    cloudId: row.id,
    deletedAt: fromDate(row.deletedAt),
  };
}

function mapCloudTask(row: typeof agentTasks.$inferSelect, firebaseUid: string): MemoryWriteTask {
  return {
    id: row.id,
    characterId: row.characterId,
    userId: firebaseUid,
    description: row.description,
    status: row.status as MemoryWriteTask['status'],
    priority: row.priority,
    dueContext: row.dueContext,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
    resolvedAt: fromDate(row.resolvedAt),
    resolutionNote: row.resolutionNote,
    syncedToCloud: 1,
    cloudId: row.id,
    deletedAt: fromDate(row.deletedAt),
  };
}

function mapCloudEvent(row: typeof memoryEvents.$inferSelect, firebaseUid: string): MemoryWriteEvent {
  return {
    id: row.id,
    characterId: row.characterId,
    userId: firebaseUid,
    eventType: row.eventType as MemoryWriteEvent['eventType'],
    summary: row.summary,
    relatedEntryId: row.relatedEntryId,
    relatedTaskId: row.relatedTaskId,
    sourceRef: row.sourceRef,
    createdAt: row.createdAt.getTime(),
    syncedToCloud: 1,
    cloudId: row.id,
  };
}

async function loadWriteSeed(
  deps: MemoryFunctionDeps,
  characterId: string,
  userId: string,
  firebaseUid: string,
): Promise<MemoryWriteEntry[]> {
  const db = await deps.getDb();
  const rows = await db
    .select()
    .from(wikiEntries)
    .where(
      and(
        eq(wikiEntries.characterId, characterId),
        eq(wikiEntries.userId, userId),
        isNull(wikiEntries.deletedAt),
      ),
    )
    .orderBy(desc(wikiEntries.updatedAt))
    .limit(100);

  return rows.map((row) => mapCloudEntry(row, firebaseUid));
}

const FUZZY_TITLE_THRESHOLD = 0.5;

function titleTokens(title: string): Set<string> {
  return new Set(title.toLowerCase().split(/\s+/).filter((t) => t.length >= 3));
}

function jaccardScore(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) {
    if (b.has(t)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function fuzzyFindEntry(
  title: string,
  candidates: MemoryWriteEntry[],
): MemoryWriteEntry | undefined {
  const tokens = titleTokens(title);
  let best: { entry: MemoryWriteEntry; score: number } | undefined;
  for (const candidate of candidates) {
    const score = jaccardScore(tokens, titleTokens(candidate.title));
    if (score >= FUZZY_TITLE_THRESHOLD && (!best || score > best.score)) {
      best = { entry: candidate, score };
    }
  }
  return best?.entry;
}

function buildWriteDiffHeuristic(
  characterId: string,
  firebaseUid: string,
  sourceText: string,
  sourceType: 'conversation' | 'user_document',
  existingEntries: MemoryWriteEntry[],
  useStableIds: boolean,
): MemoryWriteDiff {
  const now = Date.now();
  const pieces = sourceText
    .split(/(?<=[.!?])\s+/)
    .map((piece) => piece.trim())
    .filter((piece) => piece.length >= 10)
    .slice(0, 3);

  const entries: MemoryWriteEntry[] = [];
  const events: MemoryWriteEvent[] = [];
  let entriesAdded = 0;
  let entriesUpdated = 0;

  for (const [index, piece] of pieces.entries()) {
    const baseTitle = clip(piece.split(/[,.!?]/)[0] || piece, 64);
    const title = clip(baseTitle, 64);
    const existing = fuzzyFindEntry(title, existingEntries);

    if (existing) {
      const hasBodyChange = clip(piece, 200) !== existing.body;
      const updated: MemoryWriteEntry = {
        ...existing,
        body: clip(piece, 200),
        tags: inferTags(piece),
        confidence: sourceType === 'user_document' ? 'certain' : 'inferred',
        sourceType: sourceType === 'user_document' ? 'user_stated' : 'agent_inferred',
        updatedAt: now,
      };
      entries.push(updated);
      entriesUpdated += 1;

      if (hasBodyChange) {
        events.push({
          id: `event_${now}_${index}_${Math.random().toString(36).slice(2, 11)}`,
          characterId,
          userId: firebaseUid,
          eventType: 'observation',
          summary: clip(`Updated fact ${title}: ${existing.body}`, 200),
          relatedEntryId: existing.id,
          relatedTaskId: null,
          sourceRef: sourceType,
          createdAt: now,
          syncedToCloud: 0,
          cloudId: null,
        });
      }

      continue;
    }

    entries.push({
      id: useStableIds ? stableId('entry', characterId, title.toLowerCase()) : `entry_${now}_${index}_${Math.random().toString(36).slice(2, 11)}`,  
      characterId,
      userId: firebaseUid,
      title,
      body: clip(piece, 200),
      tags: inferTags(piece),
      confidence: sourceType === 'user_document' ? 'certain' : 'inferred',
      sourceType: sourceType === 'user_document' ? 'user_stated' : 'agent_inferred',
      createdAt: now,
      updatedAt: now,
      lastAccessedAt: null,
      accessCount: 0,
      syncedToCloud: 0,
      cloudId: null,
      deletedAt: null,
    });
    entriesAdded += 1;
  }

  const tasks: MemoryWriteTask[] = pieces
    .filter((piece) => isTaskSentence(piece))
    .map((piece, index) => ({
      id: useStableIds ? stableId('task', characterId, clip(piece, 64).toLowerCase()) : `task_${now}_${index}_${Math.random().toString(36).slice(2, 11)}`,  
      characterId,
      userId: firebaseUid,
      description: clip(piece, 180),
      status: 'pending',
      priority: inferPriority(piece),
      dueContext: 'next conversation',
      createdAt: now,
      updatedAt: now,
      resolvedAt: null,
      resolutionNote: null,
      syncedToCloud: 0,
      cloudId: null,
      deletedAt: null,
    }));

  events.unshift({
    id: `event_${now}_${Math.random().toString(36).slice(2, 11)}`,
    characterId,
    userId: firebaseUid,
    eventType: 'observation',
    summary: clip(sourceText, 200),
    relatedEntryId: entries[0]?.id ?? null,
    relatedTaskId: tasks[0]?.id ?? null,
    sourceRef: sourceType,
    createdAt: now,
    syncedToCloud: 0,
    cloudId: null,
  });

  const synonyms = buildSynonyms(entries);

  return {
    entriesAdded,
    entriesUpdated,
    tasksOpened: tasks.length,
    tasksClosed: 0,
    eventsAppended: events.length,
    synonymsUpdated: synonyms.length,
    entries,
    tasks,
    events,
    synonyms,
  };
}

type LLMWriteEntry = {
  title: string;
  body: string;
  tags: string[];
  confidence: string;
  sourceType: string;
};

type LLMWriteResult = {
  entries: LLMWriteEntry[];
  tasks: { description: string }[];
};

function buildWritePrompt(sourceText: string, sourceType: 'conversation' | 'user_document'): string {
  const docNote = sourceType === 'user_document' ? ' (use "certain" for document content)' : '';
  return [
    'You are a memory extractor for an AI companion app.',
    'Extract stable facts and follow-up tasks from the text below.',
    '',
    'Return ONLY a JSON object with this exact shape:',
    '{"entries":[{"title":"...","body":"...","tags":[...],"confidence":"certain|inferred","sourceType":"user_stated|agent_inferred"}],"tasks":[{"description":"..."}]}',
    '',
    'Rules:',
    '- Each entry is ONE atomic fact (preference, relationship, health, work, goal, etc.)',
    '- title: max 64 chars, descriptive name for the fact',
    '- body: max 200 chars, the fact itself',
    '- tags: 0-3 strings from: health, work, relationships, goals, emotions, schedule, finance',
    `- confidence: "certain" if directly stated, "inferred" if implied${docNote}`,
    '- sourceType: "user_stated" if user said it explicitly, "agent_inferred" if inferred',
    '- tasks: things needing follow-up (reminders, todos, check-ins); description max 180 chars',
    '- Return empty arrays if nothing found',
    '- Return ONLY the JSON, no other text',
    '',
    `Source type: ${sourceType}`,
    'Text:',
    sourceText,
  ].join('\n');
}

function parseWriteResult(raw: string): LLMWriteResult | null {
  try {
    const trimmed = raw.trim();
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start === -1 || end === -1) return null;
    const parsed: unknown = JSON.parse(trimmed.slice(start, end + 1));
    if (!isRecord(parsed) || !Array.isArray(parsed['entries'])) return null;
    const entries: LLMWriteEntry[] = (parsed['entries'] as unknown[])
      .filter((item): item is Record<string, unknown> =>
        isRecord(item) &&
        typeof item['title'] === 'string' && (item['title'] as string).trim().length > 0 &&
        typeof item['body'] === 'string',
      )
      .map((item) => ({
        title: clip(item['title'] as string, 64),
        body: clip(item['body'] as string, 200),
        tags: Array.isArray(item['tags'])
          ? (item['tags'] as unknown[]).filter((t): t is string => typeof t === 'string').slice(0, 3)
          : [],
        confidence: typeof item['confidence'] === 'string' ? item['confidence'] : '',
        sourceType: typeof item['sourceType'] === 'string' ? item['sourceType'] : '',
      }));
    const tasks = Array.isArray(parsed['tasks'])
      ? (parsed['tasks'] as unknown[])
          .filter(
            (item): item is Record<string, unknown> =>
              isRecord(item) &&
              typeof item['description'] === 'string' &&
              (item['description'] as string).trim().length > 0,
          )
          .map((item) => ({ description: clip(item['description'] as string, 180) }))
      : [];
    return { entries, tasks };
  } catch {
    return null;
  }
}

function buildWriteDiffFromLLMResult(
  characterId: string,
  firebaseUid: string,
  sourceText: string,
  sourceType: 'conversation' | 'user_document',
  existingEntries: MemoryWriteEntry[],
  useStableIds: boolean,
  llmResult: LLMWriteResult,
): MemoryWriteDiff {
  const now = Date.now();
  const defaultConfidence: MemoryWriteEntry['confidence'] = sourceType === 'user_document' ? 'certain' : 'inferred';
  const defaultSourceType: MemoryWriteEntry['sourceType'] = sourceType === 'user_document' ? 'user_stated' : 'agent_inferred';
  const entries: MemoryWriteEntry[] = [];
  const events: MemoryWriteEvent[] = [];
  let entriesAdded = 0;
  let entriesUpdated = 0;

  for (const [index, item] of llmResult.entries.entries()) {
    const title = item.title;
    const body = item.body;
    const tags = item.tags.length > 0 ? item.tags : inferTags(body);
    const confidence: MemoryWriteEntry['confidence'] =
      item.confidence === 'certain' || item.confidence === 'tentative' ? item.confidence : defaultConfidence;
    const entrySourceType: MemoryWriteEntry['sourceType'] =
      item.sourceType === 'user_stated' || item.sourceType === 'user_confirmed' ? item.sourceType : defaultSourceType;
    const existing = fuzzyFindEntry(title, existingEntries);

    if (existing) {
      const hasBodyChange = body !== existing.body;
      entries.push({
        ...existing,
        body,
        tags,
        confidence,
        sourceType: entrySourceType,
        updatedAt: now,
      });
      entriesUpdated += 1;

      if (hasBodyChange) {
        events.push({
          id: `event_${now}_${index}_${Math.random().toString(36).slice(2, 11)}`,
          characterId,
          userId: firebaseUid,
          eventType: 'observation',
          summary: clip(`Updated fact ${title}: ${existing.body}`, 200),
          relatedEntryId: existing.id,
          relatedTaskId: null,
          sourceRef: sourceType,
          createdAt: now,
          syncedToCloud: 0,
          cloudId: null,
        });
      }

      continue;
    }

    entries.push({
      id: useStableIds
        ? stableId('entry', characterId, title.toLowerCase())
        : `entry_${now}_${index}_${Math.random().toString(36).slice(2, 11)}`,
      characterId,
      userId: firebaseUid,
      title,
      body,
      tags,
      confidence,
      sourceType: entrySourceType,
      createdAt: now,
      updatedAt: now,
      lastAccessedAt: null,
      accessCount: 0,
      syncedToCloud: 0,
      cloudId: null,
      deletedAt: null,
    });
    entriesAdded += 1;
  }

  const tasks: MemoryWriteTask[] = llmResult.tasks.map((item, index) => ({
    id: useStableIds
      ? stableId('task', characterId, clip(item.description, 64).toLowerCase())
      : `task_${now}_${index}_${Math.random().toString(36).slice(2, 11)}`,
    characterId,
    userId: firebaseUid,
    description: item.description,
    status: 'pending',
    priority: inferPriority(item.description),
    dueContext: 'next conversation',
    createdAt: now,
    updatedAt: now,
    resolvedAt: null,
    resolutionNote: null,
    syncedToCloud: 0,
    cloudId: null,
    deletedAt: null,
  }));

  if (entries.length > 0 || tasks.length > 0) {
    events.unshift({
      id: `event_${now}_${Math.random().toString(36).slice(2, 11)}`,
      characterId,
      userId: firebaseUid,
      eventType: 'observation',
      summary: clip(sourceText, 200),
      relatedEntryId: entries[0]?.id ?? null,
      relatedTaskId: tasks[0]?.id ?? null,
      sourceRef: sourceType,
      createdAt: now,
      syncedToCloud: 0,
      cloudId: null,
    });
  }

  const synonyms = buildSynonyms(entries);

  return {
    entriesAdded,
    entriesUpdated,
    tasksOpened: tasks.length,
    tasksClosed: 0,
    eventsAppended: events.length,
    synonymsUpdated: synonyms.length,
    entries,
    tasks,
    events,
    synonyms,
  };
}

async function buildWriteDiff(
  characterId: string,
  firebaseUid: string,
  sourceText: string,
  sourceType: 'conversation' | 'user_document',
  existingEntries: MemoryWriteEntry[],
  useStableIds: boolean,
  generateContent: (prompt: string) => Promise<string>,
): Promise<MemoryWriteDiff> {
  try {
    const raw = await generateContent(buildWritePrompt(sourceText, sourceType));
    const llmResult = parseWriteResult(raw);
    if (llmResult !== null) {
      return buildWriteDiffFromLLMResult(
        characterId, firebaseUid, sourceText, sourceType, existingEntries, useStableIds, llmResult,
      );
    }
    logger.warn('buildWriteDiff LLM returned unparsable result, using heuristic fallback');
  } catch (err: unknown) {
    logger.warn('buildWriteDiff LLM extraction failed, using heuristic fallback', { err });
  }

  return buildWriteDiffHeuristic(characterId, firebaseUid, sourceText, sourceType, existingEntries, useStableIds);
}

async function persistWriteDiff(
  deps: MemoryFunctionDeps,
  characterId: string,
  userId: string,
  diff: MemoryWriteDiff,
): Promise<void> {
  const db = await deps.getDb();

  if (diff.entries.length > 0) {
    await db
      .insert(wikiEntries)
      .values(
        diff.entries.map((entry) => ({
          id: entry.id,
          characterId,
          userId,
          title: entry.title,
          body: entry.body,
          tags: entry.tags,
          confidence: entry.confidence,
          sourceType: entry.sourceType,
          createdAt: toDate(entry.createdAt) ?? new Date(),
          updatedAt: toDate(entry.updatedAt) ?? new Date(),
          lastAccessedAt: toDate(entry.lastAccessedAt),
          accessCount: entry.accessCount,
          deletedAt: toDate(entry.deletedAt),
        })),
      )
      .onConflictDoUpdate({
        target: wikiEntries.id,
        set: {
          title: sql`excluded.title`,
          body: sql`excluded.body`,
          tags: sql`excluded.tags`,
          confidence: sql`excluded.confidence`,
          sourceType: sql`excluded.source_type`,
          updatedAt: sql`excluded.updated_at`,
          lastAccessedAt: sql`excluded.last_accessed_at`,
          accessCount: sql`excluded.access_count`,
          deletedAt: sql`excluded.deleted_at`,
        },
      });
  }

  if (diff.tasks.length > 0) {
    await db
      .insert(agentTasks)
      .values(
        diff.tasks.map((task) => ({
          id: task.id,
          characterId,
          userId,
          description: task.description,
          status: task.status,
          priority: task.priority,
          dueContext: task.dueContext,
          createdAt: toDate(task.createdAt) ?? new Date(),
          updatedAt: toDate(task.updatedAt) ?? new Date(),
          resolvedAt: toDate(task.resolvedAt),
          resolutionNote: task.resolutionNote,
          deletedAt: toDate(task.deletedAt),
        })),
      )
      .onConflictDoUpdate({
        target: agentTasks.id,
        set: {
          description: sql`excluded.description`,
          status: sql`excluded.status`,
          priority: sql`excluded.priority`,
          dueContext: sql`excluded.due_context`,
          updatedAt: sql`excluded.updated_at`,
          resolvedAt: sql`excluded.resolved_at`,
          resolutionNote: sql`excluded.resolution_note`,
          deletedAt: sql`excluded.deleted_at`,
        },
      });
  }

  if (diff.events.length > 0) {
    await db
      .insert(memoryEvents)
      .values(
        diff.events.map((event) => ({
          id: event.id,
          characterId,
          userId,
          eventType: event.eventType,
          summary: event.summary,
          relatedEntryId: event.relatedEntryId,
          relatedTaskId: event.relatedTaskId,
          sourceRef: event.sourceRef,
          createdAt: toDate(event.createdAt) ?? new Date(),
        })),
      )
      .onConflictDoUpdate({
        target: memoryEvents.id,
        set: {
          eventType: sql`excluded.event_type`,
          summary: sql`excluded.summary`,
          relatedEntryId: sql`excluded.related_entry_id`,
          relatedTaskId: sql`excluded.related_task_id`,
          sourceRef: sql`excluded.source_ref`,
        },
      });
  }
}

function taskAlreadyCoveredByEntries(task: MemoryWriteTask, entries: MemoryWriteEntry[]): boolean {
  const title = `${task.description} ${task.dueContext ?? ''}`.toLowerCase();
  return entries.some((entry) => `${entry.title} ${entry.body}`.toLowerCase().includes(title.slice(0, 20)));
}

type ContradictionPair = { entryAId: string; entryBId: string; reason: string };

function buildContradictionPrompt(entries: MemoryWriteEntry[]): string {
  const items = entries
    .filter((e) => e.deletedAt === null)
    .map((e) => ({ id: e.id, title: e.title, body: e.body }));
  return [
    'You are a memory auditor. Review the following memory entries and identify any pairs that state conflicting or contradictory facts.',
    'Return ONLY a JSON array of objects with shape: [{"entryAId": "...", "entryBId": "...", "reason": "..."}]',
    'If there are no contradictions, return an empty array: []',
    'Do not include any explanation outside the JSON array.',
    '',
    'Memory entries:',
    JSON.stringify(items),
  ].join('\n');
}

function parseContradictions(raw: string): ContradictionPair[] {
  try {
    const trimmed = raw.trim();
    const start = trimmed.indexOf('[');
    const end = trimmed.lastIndexOf(']');
    if (start === -1 || end === -1) return [];
    const parsed: unknown = JSON.parse(trimmed.slice(start, end + 1));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is ContradictionPair =>
        isRecord(item) &&
        typeof item['entryAId'] === 'string' &&
        typeof item['entryBId'] === 'string' &&
        typeof item['reason'] === 'string',
    );
  } catch {
    return [];
  }
}

async function detectContradictions(
  entries: MemoryWriteEntry[],
  generateContent: (prompt: string) => Promise<string>,
): Promise<ContradictionPair[]> {
  if (entries.filter((e) => e.deletedAt === null).length < 2) return [];
  try {
    const raw = await generateContent(buildContradictionPrompt(entries));
    return parseContradictions(raw);
  } catch (err: unknown) {
    logger.warn('detectContradictions LLM call failed, skipping', { err });
    return [];
  }
}

async function buildHealDiff(
  deps: MemoryFunctionDeps,
  characterId: string,
  userId: string,
  firebaseUid: string,
  seed?: { entries: MemoryWriteEntry[]; tasks: MemoryWriteTask[] },
): Promise<MemoryHealDiff> {
  // user_document entries are treated as immutable anchors:
  // skipped in contradiction, stale, and orphan passes.
  const now = Date.now();
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
  const sixtyDaysAgo = now - 60 * 24 * 60 * 60 * 1000;

  let mappedEntries: MemoryWriteEntry[];
  let openTaskRows: MemoryWriteTask[];

  if (seed) {
    mappedEntries = seed.entries;
    openTaskRows = seed.tasks;
  } else {
    const db = await deps.getDb();
    const entriesRows = await db
      .select()
      .from(wikiEntries)
      .where(
        and(
          eq(wikiEntries.characterId, characterId),
          eq(wikiEntries.userId, userId),
          isNull(wikiEntries.deletedAt),
        ),
      )
      .orderBy(
        asc(sql`CASE WHEN ${wikiEntries.confidence} = 'certain' THEN 0 ELSE 1 END`),
        desc(wikiEntries.accessCount),
        desc(wikiEntries.updatedAt),
      )
      .limit(100);

    const taskRows = await db
      .select()
      .from(agentTasks)
      .where(
        and(
          eq(agentTasks.characterId, characterId),
          eq(agentTasks.userId, userId),
          eq(agentTasks.status, 'pending'),
          isNull(agentTasks.deletedAt),
        ),
      )
      .orderBy(desc(agentTasks.priority), desc(agentTasks.updatedAt))
      .limit(20);

    mappedEntries = entriesRows.map((row) => mapCloudEntry(row, firebaseUid));
    openTaskRows = taskRows.map((row) => mapCloudTask(row, firebaseUid));
  }

  // Filter user_document entries before sending to LLM for contradiction detection.
  // These entries are treated as immutable anchors — they cannot be contradicted.
  // Passing them to the LLM wastes tokens and re-exposes user document content on every heal pass.
  const contradictionCandidates = mappedEntries.filter((e) => e.sourceType !== 'user_document');

  const contradictionPairs = await detectContradictions(contradictionCandidates, deps.generateContent);
  const contradictedIds = new Set(
    contradictionPairs.flatMap((p) => [p.entryAId, p.entryBId]),
  );
  const events: MemoryWriteEvent[] = [];
  let staleDowngraded = 0;
  let orphansRemoved = 0;
  let conceptsSeeded = 0;
  let contradictionsFlagged = 0;

  const updatedEntries: MemoryWriteEntry[] = mappedEntries.map((entry) => {
    const isUserDoc = entry.sourceType === 'user_document';
    const stale = entry.lastAccessedAt !== null && entry.lastAccessedAt < sixtyDaysAgo;
    const orphan = entry.accessCount === 0 && entry.updatedAt < thirtyDaysAgo;

    if (orphan && !isUserDoc && entry.deletedAt === null) {
      orphansRemoved += 1;
      return {
        ...entry,
        updatedAt: now,
        deletedAt: now,
      };
    }

    if (stale && !isUserDoc && entry.confidence === 'inferred') {
      staleDowngraded += 1;
      return {
        ...entry,
        confidence: 'tentative',
        updatedAt: now,
      };
    }

    if (!isUserDoc && contradictedIds.has(entry.id) && entry.confidence !== 'tentative' && entry.confidence !== 'certain') {
      return {
        ...entry,
        confidence: 'tentative',
        updatedAt: now,
      };
    }

    return entry;
  });

  for (const pair of contradictionPairs) {
    const entryA = mappedEntries.find((e) => e.id === pair.entryAId);
    const entryB = mappedEntries.find((e) => e.id === pair.entryBId);
    if (!entryA || !entryB) continue;
    // Skip if either entry is a user_document anchor
    if (entryA.sourceType === 'user_document' || entryB.sourceType === 'user_document') continue;
    const older = entryA.updatedAt <= entryB.updatedAt ? entryA : entryB;
    contradictionsFlagged += 1;
    events.push({
      id: `event_${now}_${Math.random().toString(36).slice(2, 11)}`,
      characterId,
      userId: firebaseUid,
      eventType: 'observation',
      summary: clip(`Contradiction detected: "${older.title}" conflicts with another entry. ${pair.reason}`, 200),
      relatedEntryId: older.id,
      relatedTaskId: null,
      sourceRef: 'memory_heal',
      createdAt: now,
      syncedToCloud: 0,
      cloudId: null,
    });
  }

  const seededEntries: MemoryWriteEntry[] = [];
  for (const task of openTaskRows) {
    if (taskAlreadyCoveredByEntries(task, updatedEntries)) {
      continue;
    }

    const seededId = `entry_${now}_${Math.random().toString(36).slice(2, 11)}`;
    seededEntries.push({
      id: seededId,
      characterId,
      userId: firebaseUid,
      title: clip(task.description, 64),
      body: clip(`Potential missing concept from open task: ${task.description}`, 200),
      tags: ['goals'],
      confidence: 'tentative',
      sourceType: 'agent_inferred',
      createdAt: now,
      updatedAt: now,
      lastAccessedAt: null,
      accessCount: 0,
      syncedToCloud: 0,
      cloudId: null,
      deletedAt: null,
    });

    events.push({
      id: `event_${now}_${Math.random().toString(36).slice(2, 11)}`,
      characterId,
      userId: firebaseUid,
      eventType: 'observation',
      summary: clip(`Seeded memory concept from open task: ${task.description}`, 200),
      relatedEntryId: seededId,
      relatedTaskId: task.id,
      sourceRef: 'memory_heal',
      createdAt: now,
      syncedToCloud: 0,
      cloudId: null,
    });

    conceptsSeeded += 1;
  }

  const entries = [...updatedEntries, ...seededEntries];
  const tasks = openTaskRows;

  return {
    contradictionsFlagged,
    staleDowngraded,
    orphansRemoved,
    conceptsSeeded,
    entries,
    tasks,
    events,
  };
}

async function persistHealDiff(
  deps: MemoryFunctionDeps,
  characterId: string,
  userId: string,
  diff: MemoryHealDiff,
): Promise<void> {
  await persistWriteDiff(deps, characterId, userId, {
    entriesAdded: 0,
    entriesUpdated: diff.entries.length,
    tasksOpened: 0,
    tasksClosed: 0,
    eventsAppended: diff.events.length,
    synonymsUpdated: 0,
    entries: diff.entries,
    tasks: [],
    events: diff.events,
    synonyms: [],
  });
}

export const memoryReadHandler = async (
  request: CallableRequest,
  deps: MemoryFunctionDeps = defaultDeps,
) => {
  const identity = await authenticateAndResolveIdentity(request, deps);

  const payload = request.data as MemoryReadPayload;
  const characterId = parseCharacterId(payload);
  const query = parseOptionalQuery(payload);

  if (!identity.hasUnlimited) {
    throw new HttpsError('permission-denied', 'Memory read is available only for unlimited plans.');
  }

  const ownsCharacter = await hasOwnedCloudCharacter(deps, characterId, identity.userId);
  if (!ownsCharacter) {
    return buildEmptyReadResponse(characterId, query);
  }

  const db = await deps.getDb();
  const entryWhere = and(
    eq(wikiEntries.characterId, characterId),
    eq(wikiEntries.userId, identity.userId),
    isNull(wikiEntries.deletedAt),
    query.length > 0
      ? sql`to_tsvector('english', coalesce(${wikiEntries.title}, '') || ' ' || coalesce(${wikiEntries.body}, '') || ' ' || coalesce(${wikiEntries.tags}::text, '')) @@ websearch_to_tsquery('english', ${query})`
      : undefined,
  );

  const [entriesRows, taskRows, eventRows] = await Promise.all([
    db
      .select()
      .from(wikiEntries)
      .where(entryWhere)
      .orderBy(desc(wikiEntries.updatedAt))
      .limit(10),
    db
      .select()
      .from(agentTasks)
      .where(
        and(
          eq(agentTasks.characterId, characterId),
          eq(agentTasks.userId, identity.userId),
          eq(agentTasks.status, 'pending'),
          isNull(agentTasks.deletedAt),
        ),
      )
      .orderBy(desc(agentTasks.priority), desc(agentTasks.updatedAt))
      .limit(5),
    db
      .select()
      .from(memoryEvents)
      .where(and(eq(memoryEvents.characterId, characterId), eq(memoryEvents.userId, identity.userId)))
      .orderBy(desc(memoryEvents.createdAt))
      .limit(3),
  ]);

  return {
    characterId,
    query,
    entries: entriesRows.map((row) => mapCloudEntry(row, identity.firebaseUid)),
    tasks: taskRows.map((row) => mapCloudTask(row, identity.firebaseUid)),
    events: eventRows.map((row) => mapCloudEvent(row, identity.firebaseUid)),
    synonyms: buildSynonyms(entriesRows.map((row) => mapCloudEntry(row, identity.firebaseUid))),
  };
};

export const memoryWriteHandler = async (
  request: CallableRequest,
  deps: MemoryFunctionDeps = defaultDeps,
) => {
  const identity = await authenticateAndResolveIdentity(request, deps);
  const payload = request.data as MemoryWritePayload;

  const characterId = parseCharacterId(payload);
  const sourceText = parseSourceText(payload);
  const sourceType = parseSourceType(payload);

  if (!identity.hasUnlimited) {
    throw new HttpsError('permission-denied', 'Memory write is available only for unlimited plans.');
  }

  const ownsCharacter = await hasOwnedCloudCharacter(deps, characterId, identity.userId);
  const seedEntries = ownsCharacter ? await loadWriteSeed(deps, characterId, identity.userId, identity.firebaseUid) : [];
  const diff = await buildWriteDiff(characterId, identity.firebaseUid, sourceText, sourceType, seedEntries, !ownsCharacter, deps.generateContent);

  if (ownsCharacter) {
    await persistWriteDiff(deps, characterId, identity.userId, diff);
    for (const entry of diff.entries) { entry.syncedToCloud = 1; entry.cloudId = entry.id; }
    for (const task of diff.tasks) { task.syncedToCloud = 1; task.cloudId = task.id; }
    for (const event of diff.events) { event.syncedToCloud = 1; event.cloudId = event.id; }
  }

  return { diff };
};

export const memoryHealHandler = async (
  request: CallableRequest,
  deps: MemoryFunctionDeps = defaultDeps,
) => {
  const identity = await authenticateAndResolveIdentity(request, deps);
  const characterId = parseCharacterId(request.data);

  if (!identity.hasUnlimited) {
    return {
      diff: buildEmptyHealDiff(),
    };
  }

  const ownsCharacter = await hasOwnedCloudCharacter(deps, characterId, identity.userId);

  let seed: { entries: MemoryWriteEntry[]; tasks: MemoryWriteTask[] } | undefined;
  if (!ownsCharacter && isRecord(request.data) && isRecord(request.data['localDump'])) {
    const dump = request.data['localDump'];
    seed = {
      entries: parseLocalDumpEntries(characterId, identity.firebaseUid, dump['entries']),
      tasks: parseLocalDumpTasks(characterId, identity.firebaseUid, dump['tasks']),
    };
  }

  const diff = await buildHealDiff(deps, characterId, identity.userId, identity.firebaseUid, seed);

  if (ownsCharacter) {
    await persistHealDiff(deps, characterId, identity.userId, diff);
    for (const entry of diff.entries) { entry.syncedToCloud = 1; entry.cloudId = entry.id; }
    for (const task of diff.tasks) { task.syncedToCloud = 1; task.cloudId = task.id; }
    for (const event of diff.events) { event.syncedToCloud = 1; event.cloudId = event.id; }
  }

  return {
    diff,
  };
};

export const memoryForgetHandler = async (
  request: CallableRequest,
  deps: MemoryFunctionDeps = defaultDeps,
) => {
  const identity = await authenticateAndResolveIdentity(request, deps);
  const payload = request.data as MemoryForgetPayload;

  const characterId = parseCharacterId(payload);
  const targets = parseForgetTargets(payload);

  if (!identity.hasUnlimited) {
    throw new HttpsError('permission-denied', 'Memory forget is available only for unlimited plans.');
  }

  const ownsCharacter = await hasOwnedCloudCharacter(deps, characterId, identity.userId);
  if (!ownsCharacter) {
    return {
      success: true,
      deleted: {
        entries: 0,
        tasks: 0,
      },
    };
  }

  const db = await deps.getDb();
  const deletedAt = new Date();
  let deletedEntries = 0;
  let deletedTasks = 0;

  if (targets.clearAll) {
    const [entryRows, taskRows] = await Promise.all([
      db
        .update(wikiEntries)
        .set({ deletedAt, updatedAt: deletedAt })
        .where(
          and(
            eq(wikiEntries.characterId, characterId),
            eq(wikiEntries.userId, identity.userId),
            isNull(wikiEntries.deletedAt),
          ),
        )
        .returning({ id: wikiEntries.id }),
      db
        .update(agentTasks)
        .set({ deletedAt, updatedAt: deletedAt })
        .where(
          and(
            eq(agentTasks.characterId, characterId),
            eq(agentTasks.userId, identity.userId),
            isNull(agentTasks.deletedAt),
          ),
        )
        .returning({ id: agentTasks.id }),
    ]);

    deletedEntries = entryRows.length;
    deletedTasks = taskRows.length;
  } else {
    if (targets.entryIds.length > 0) {
      const rows = await db
        .update(wikiEntries)
        .set({ deletedAt, updatedAt: deletedAt })
        .where(
          and(
            eq(wikiEntries.characterId, characterId),
            eq(wikiEntries.userId, identity.userId),
            inArray(wikiEntries.id, targets.entryIds),
            isNull(wikiEntries.deletedAt),
          ),
        )
        .returning({ id: wikiEntries.id });
      deletedEntries = rows.length;
    }

    if (targets.taskIds.length > 0) {
      const rows = await db
        .update(agentTasks)
        .set({ deletedAt, updatedAt: deletedAt })
        .where(
          and(
            eq(agentTasks.characterId, characterId),
            eq(agentTasks.userId, identity.userId),
            inArray(agentTasks.id, targets.taskIds),
            isNull(agentTasks.deletedAt),
          ),
        )
        .returning({ id: agentTasks.id });
      deletedTasks = rows.length;
    }

    if (targets.sourceRef !== null) {
      const rows = await db
        .update(wikiEntries)
        .set({ deletedAt, updatedAt: deletedAt })
        .where(
          and(
            eq(wikiEntries.characterId, characterId),
            eq(wikiEntries.userId, identity.userId),
            eq(wikiEntries.sourceRef, targets.sourceRef),
            isNull(wikiEntries.deletedAt),
          ),
        )
        .returning({ id: wikiEntries.id });
      deletedEntries += rows.length;
    }

    if (targets.sourceHash !== null) {
      const rows = await db
        .update(wikiEntries)
        .set({ deletedAt, updatedAt: deletedAt })
        .where(
          and(
            eq(wikiEntries.characterId, characterId),
            eq(wikiEntries.userId, identity.userId),
            eq(wikiEntries.sourceHash, targets.sourceHash),
            isNull(wikiEntries.deletedAt),
          ),
        )
        .returning({ id: wikiEntries.id });
      deletedEntries += rows.length;
    }
  }

  return {
    success: true,
    deleted: {
      entries: deletedEntries,
      tasks: deletedTasks,
    },
  };
};

export const syncCharacterMemoryHandler = async (
  request: CallableRequest,
  deps: MemoryFunctionDeps = defaultDeps,
) => {
  const identity = await authenticateAndResolveIdentity(request, deps);
  const characterId = parseCharacterId(request.data);

  if (!identity.hasUnlimited) {
    return {
      syncedEntries: 0,
      syncedTasks: 0,
      syncedEvents: 0,
    };
  }

  const ownsCharacter = await hasOwnedCloudCharacter(deps, characterId, identity.userId);
  if (!ownsCharacter) {
    return {
      syncedEntries: 0,
      syncedTasks: 0,
      syncedEvents: 0,
    };
  }

  const db = await deps.getDb();
  const [entryCount, taskCount, eventCount] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(wikiEntries)
      .where(and(eq(wikiEntries.characterId, characterId), eq(wikiEntries.userId, identity.userId))),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(agentTasks)
      .where(and(eq(agentTasks.characterId, characterId), eq(agentTasks.userId, identity.userId))),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(memoryEvents)
      .where(and(eq(memoryEvents.characterId, characterId), eq(memoryEvents.userId, identity.userId))),
  ]);

  return {
    syncedEntries: entryCount[0]?.count ?? 0,
    syncedTasks: taskCount[0]?.count ?? 0,
    syncedEvents: eventCount[0]?.count ?? 0,
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
