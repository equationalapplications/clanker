import {onCall, HttpsError, CallableRequest} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import type {DecodedIdToken} from "firebase-admin/auth";
import {inArray, and, eq, sql} from "drizzle-orm";
import {CLOUD_SQL_SECRETS} from "./cloudSqlSecrets.js";
import {userRepository} from "./services/userRepository.js";
import {subscriptionService} from "./services/subscriptionService.js";
import {getDb} from "./db/cloudSql.js";
import {llmWikiEntries, llmWikiTasks, llmWikiEvents, characters} from "./db/schema.js";
import {PREMIUM_TIERS} from "./constants/plans.js";

const DEFAULT_REGION = "us-central1";

interface WikiFact {
  id: string;
  entity_id: string;
  title: string;
  body: string;
  confidence: string;
  tags: string[];
  source_type?: string | null;
  source_ref?: string | null;
  source_hash?: string | null;
  last_accessed_at?: number | null;
  access_count?: number | null;
  created_at: number;
  updated_at: number;
  deleted_at?: number | null;
}

interface WikiTask {
  id: string;
  entity_id: string;
  description: string;
  status: string;
  priority: number;
  created_at: number;
  updated_at: number;
  resolved_at?: number | null;
  deleted_at?: number | null;
}

interface WikiEvent {
  id: string;
  entity_id: string;
  event_type: string;
  summary: string;
  created_at: number;
}

interface MemoryBundle {
  facts: WikiFact[];
  tasks: WikiTask[];
  events: WikiEvent[];
}

export interface MemoryDump {
  generatedAt: number;
  entities: Record<string, MemoryBundle>;
}

interface WikiSyncOptions {
  /** Full-dump upsert override (preferred for tests; supersedes upsertEntries). */
  upsertData?: (dump: MemoryDump, userId: string) => Promise<void>;
  /** Legacy fact-only upsert override; ignored when upsertData is provided. */
  upsertEntries?: (entries: WikiFact[], userId: string) => Promise<void>;
  validateEntityOwnership?: (entityIds: string[], userId: string) => Promise<void>;
  fetchMergedDump?: (entityIds: string[], userId: string) => Promise<MemoryDump>;
  getUser?: typeof userRepository.getOrCreateUserByFirebaseIdentity;
  getSubscription?: typeof subscriptionService.getSubscription;
}

const MAX_ENTITIES = 50;
const MAX_FACTS_PER_ENTITY = 500;
const MAX_TASKS_PER_ENTITY = 200;
const MAX_EVENTS_PER_ENTITY = 500;
/** 30-day event retention window in milliseconds — matches runPrune retainEventsFor policy. */
const WIKI_EVENTS_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VALID_CONFIDENCE = new Set(["certain", "inferred", "tentative"]);
const VALID_SOURCE_TYPE = new Set(["user_stated", "agent_inferred", "user_confirmed", "user_document"]);

function assertString(value: unknown, label: string): void {
  if (typeof value !== "string" || value.length === 0) {
    throw new HttpsError("invalid-argument", `${label} must be a non-empty string.`);
  }
}

function assertNumber(value: unknown, label: string): void {
  if (typeof value !== "number" || !isFinite(value)) {
    throw new HttpsError("invalid-argument", `${label} must be a finite number.`);
  }
}

function validateFact(fact: unknown, entityId: string, label: string): void {
  if (!fact || typeof fact !== "object" || Array.isArray(fact)) {
    throw new HttpsError("invalid-argument", `${label} must be an object.`);
  }
  const f = fact as Record<string, unknown>;
  assertString(f.id, `${label}.id`);
  if (f.entity_id !== entityId) {
    throw new HttpsError(
      "invalid-argument",
      `${label}.entity_id must match the entity key "${entityId}".`
    );
  }
  assertString(f.title, `${label}.title`);
  assertString(f.body, `${label}.body`);
  assertString(f.confidence, `${label}.confidence`);
  if (!VALID_CONFIDENCE.has(f.confidence as string)) {
    throw new HttpsError(
      "invalid-argument",
      `${label}.confidence must be one of: certain, inferred, tentative.`
    );
  }
  if (!Array.isArray(f.tags)) {
    throw new HttpsError("invalid-argument", `${label}.tags must be an array.`);
  }
  f.tags.forEach((tag: unknown, i: number) => {
    if (typeof tag !== "string") {
      throw new HttpsError("invalid-argument", `${label}.tags[${i}] must be a string.`);
    }
  });
  if (f.source_ref !== undefined && f.source_ref !== null && typeof f.source_ref !== "string") {
    throw new HttpsError("invalid-argument", `${label}.source_ref must be a string or null.`);
  }
  if (f.source_hash !== undefined && f.source_hash !== null && typeof f.source_hash !== "string") {
    throw new HttpsError("invalid-argument", `${label}.source_hash must be a string or null.`);
  }
  if (f.source_type !== undefined && f.source_type !== null) {
    if (typeof f.source_type !== "string" || !VALID_SOURCE_TYPE.has(f.source_type as string)) {
      throw new HttpsError(
        "invalid-argument",
        `${label}.source_type must be one of: user_stated, agent_inferred, user_confirmed, user_document.`
      );
    }
  }
  if (f.last_accessed_at !== undefined && f.last_accessed_at !== null) {
    if (
      typeof f.last_accessed_at !== "number" ||
      !isFinite(f.last_accessed_at as number) ||
      !Number.isInteger(f.last_accessed_at as number)
    ) {
      throw new HttpsError("invalid-argument", `${label}.last_accessed_at must be an integer or null.`);
    }
  }
  if (f.access_count !== undefined && f.access_count !== null) {
    if (
      typeof f.access_count !== "number" ||
      !isFinite(f.access_count as number) ||
      !Number.isInteger(f.access_count as number) ||
      (f.access_count as number) < 0
    ) {
      throw new HttpsError("invalid-argument", `${label}.access_count must be a non-negative integer or null.`);
    }
  }
  if (f.deleted_at !== undefined && f.deleted_at !== null && typeof f.deleted_at !== "number") {
    throw new HttpsError("invalid-argument", `${label}.deleted_at must be a number or null.`);
  }
  assertNumber(f.created_at, `${label}.created_at`);
  assertNumber(f.updated_at, `${label}.updated_at`);
}

function validateTask(task: unknown, entityId: string, label: string): void {
  if (!task || typeof task !== "object" || Array.isArray(task)) {
    throw new HttpsError("invalid-argument", `${label} must be an object.`);
  }
  const t = task as Record<string, unknown>;
  assertString(t.id, `${label}.id`);
  if (t.entity_id !== entityId) {
    throw new HttpsError(
      "invalid-argument",
      `${label}.entity_id must match the entity key "${entityId}".`
    );
  }
  assertString(t.description, `${label}.description`);
  assertString(t.status, `${label}.status`);
  assertNumber(t.priority, `${label}.priority`);
  assertNumber(t.created_at, `${label}.created_at`);
  assertNumber(t.updated_at, `${label}.updated_at`);
  if (t.resolved_at !== undefined && t.resolved_at !== null && typeof t.resolved_at !== "number") {
    throw new HttpsError("invalid-argument", `${label}.resolved_at must be a number or null.`);
  }
  if (t.deleted_at !== undefined && t.deleted_at !== null && typeof t.deleted_at !== "number") {
    throw new HttpsError("invalid-argument", `${label}.deleted_at must be a number or null.`);
  }
}

function validateEvent(event: unknown, entityId: string, label: string): void {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    throw new HttpsError("invalid-argument", `${label} must be an object.`);
  }
  const e = event as Record<string, unknown>;
  assertString(e.id, `${label}.id`);
  if (e.entity_id !== entityId) {
    throw new HttpsError(
      "invalid-argument",
      `${label}.entity_id must match the entity key "${entityId}".`
    );
  }
  assertString(e.event_type, `${label}.event_type`);
  assertString(e.summary, `${label}.summary`);
  assertNumber(e.created_at, `${label}.created_at`);
}

function parseInput(data: unknown): MemoryDump {
  if (!data || typeof data !== "object") {
    throw new HttpsError("invalid-argument", "Request body must be an object.");
  }

  const d = data as Record<string, unknown>;
  if (!d.dump || typeof d.dump !== "object") {
    throw new HttpsError("invalid-argument", "dump is required.");
  }

  const rawDump = d.dump as Record<string, unknown>;
  assertNumber(rawDump.generatedAt, "dump.generatedAt");
  if (!rawDump.entities || typeof rawDump.entities !== "object" || Array.isArray(rawDump.entities)) {
    throw new HttpsError("invalid-argument", "dump.entities must be an object.");
  }

  const entities = rawDump.entities as Record<string, unknown>;
  const entityIds = Object.keys(entities);
  if (entityIds.length > MAX_ENTITIES) {
    throw new HttpsError(
      "invalid-argument",
      `dump.entities may not contain more than ${MAX_ENTITIES} entities.`
    );
  }

  for (const entityId of entityIds) {
    if (!UUID_PATTERN.test(entityId)) {
      throw new HttpsError("invalid-argument", `Entity key "${entityId}" is not a valid UUID.`);
    }
  }

  for (const [entityId, bundle] of Object.entries(entities)) {
    if (!bundle || typeof bundle !== "object" || Array.isArray(bundle)) {
      throw new HttpsError("invalid-argument", `Entity "${entityId}" must be an object.`);
    }
    const b = bundle as Record<string, unknown>;
    if (!Array.isArray(b.facts)) {
      throw new HttpsError("invalid-argument", `Entity "${entityId}".facts must be an array.`);
    }
    if (!Array.isArray(b.tasks)) {
      throw new HttpsError("invalid-argument", `Entity "${entityId}".tasks must be an array.`);
    }
    if (!Array.isArray(b.events)) {
      throw new HttpsError("invalid-argument", `Entity "${entityId}".events must be an array.`);
    }

    if (b.facts.length > MAX_FACTS_PER_ENTITY) {
      throw new HttpsError(
        "invalid-argument",
        `Entity "${entityId}" may not contain more than ${MAX_FACTS_PER_ENTITY} facts.`
      );
    }
    if (b.tasks.length > MAX_TASKS_PER_ENTITY) {
      throw new HttpsError(
        "invalid-argument",
        `Entity "${entityId}" may not contain more than ${MAX_TASKS_PER_ENTITY} tasks.`
      );
    }
    if (b.events.length > MAX_EVENTS_PER_ENTITY) {
      throw new HttpsError(
        "invalid-argument",
        `Entity "${entityId}" may not contain more than ${MAX_EVENTS_PER_ENTITY} events.`
      );
    }

    b.facts.forEach((f: unknown, i: number) => validateFact(f, entityId, `Entity "${entityId}".facts[${i}]`));
    b.tasks.forEach((t: unknown, i: number) => validateTask(t, entityId, `Entity "${entityId}".tasks[${i}]`));
    b.events.forEach((e: unknown, i: number) => validateEvent(e, entityId, `Entity "${entityId}".events[${i}]`));
  }

  return d.dump as unknown as MemoryDump;
}

async function fetchMergedDump(entityIds: string[], userId: string): Promise<MemoryDump> {
  if (entityIds.length === 0) {
    return {generatedAt: Date.now(), entities: {}};
  }
  const db = await getDb();
  const retentionCutoff = Date.now() - WIKI_EVENTS_RETENTION_MS;

  // Use SQL window functions (ROW_NUMBER OVER PARTITION BY entity_id) to enforce
  // per-entity caps directly in the database with a single query per table.
  // Each entity gets its own row-number sequence so no "hot" entity can starve
  // others. Tombstones (deleted_at NOT NULL) sort first within each partition so
  // cross-device deletions are always included within the per-entity cap —
  // matching the LWW deletion propagation requirement from the spec.
  type FactRow = {
    id: string;
    entity_id: string;
    title: string;
    body: string;
    confidence: string;
    tags: unknown;
    source_ref: string | null;
    source_hash: string | null;
    source_type: string;
    last_accessed_at: string | null;
    access_count: string | number | null;
    created_at: string;
    updated_at: string;
    deleted_at: string | null;
  };
  type TaskRow = {
    id: string;
    entity_id: string;
    description: string;
    status: string;
    priority: string | number;
    created_at: string;
    updated_at: string;
    resolved_at: string | null;
    deleted_at: string | null;
  };
  type EventRow = {
    id: string;
    entity_id: string;
    event_type: string;
    summary: string;
    created_at: string;
  };

  const [factResult, taskResult, eventResult] = await Promise.all([
    db.execute<FactRow>(sql`
      WITH ranked AS (
        SELECT *,
          ROW_NUMBER() OVER (
            PARTITION BY entity_id
            ORDER BY deleted_at DESC NULLS LAST, updated_at DESC
          ) AS rn
        FROM llm_wiki_entries
        WHERE entity_id = ANY(${entityIds}::uuid[])
          AND user_id = ${userId}::uuid
      )
      SELECT * FROM ranked WHERE rn <= ${MAX_FACTS_PER_ENTITY}
    `),
    db.execute<TaskRow>(sql`
      WITH ranked AS (
        SELECT *,
          ROW_NUMBER() OVER (
            PARTITION BY entity_id
            ORDER BY deleted_at DESC NULLS LAST, updated_at DESC
          ) AS rn
        FROM llm_wiki_tasks
        WHERE entity_id = ANY(${entityIds}::uuid[])
          AND user_id = ${userId}::uuid
      )
      SELECT * FROM ranked WHERE rn <= ${MAX_TASKS_PER_ENTITY}
    `),
    db.execute<EventRow>(sql`
      WITH ranked AS (
        SELECT *,
          ROW_NUMBER() OVER (
            PARTITION BY entity_id
            ORDER BY created_at DESC
          ) AS rn
        FROM llm_wiki_events
        WHERE entity_id = ANY(${entityIds}::uuid[])
          AND user_id = ${userId}::uuid
          AND created_at >= ${retentionCutoff}
      )
      SELECT * FROM ranked WHERE rn <= ${MAX_EVENTS_PER_ENTITY}
    `),
  ]);

  const entities: Record<string, MemoryBundle> = {};
  for (const entityId of entityIds) {
    entities[entityId] = {facts: [], tasks: [], events: []};
  }

  for (const r of factResult.rows) {
    const entity = entities[r.entity_id];
    if (!entity) continue;
    entity.facts.push({
      id: r.id,
      entity_id: r.entity_id,
      title: r.title,
      body: r.body,
      confidence: r.confidence,
      tags: (r.tags ?? []) as string[],
      source_type: r.source_type ?? null,
      source_ref: r.source_ref ?? null,
      source_hash: r.source_hash ?? null,
      last_accessed_at: r.last_accessed_at != null ? Number(r.last_accessed_at) : null,
      access_count: r.access_count != null ? Number(r.access_count) : 0,
      created_at: Number(r.created_at),
      updated_at: Number(r.updated_at),
      deleted_at: r.deleted_at != null ? Number(r.deleted_at) : null,
    });
  }

  for (const r of taskResult.rows) {
    const entity = entities[r.entity_id];
    if (!entity) continue;
    entity.tasks.push({
      id: r.id,
      entity_id: r.entity_id,
      description: r.description,
      status: r.status,
      priority: Number(r.priority),
      created_at: Number(r.created_at),
      updated_at: Number(r.updated_at),
      resolved_at: r.resolved_at != null ? Number(r.resolved_at) : null,
      deleted_at: r.deleted_at != null ? Number(r.deleted_at) : null,
    });
  }

  for (const r of eventResult.rows) {
    const entity = entities[r.entity_id];
    if (!entity) continue;
    entity.events.push({
      id: r.id,
      entity_id: r.entity_id,
      event_type: r.event_type,
      summary: r.summary,
      created_at: Number(r.created_at),
    });
  }

  return {generatedAt: Date.now(), entities};
}

async function upsertWikiData(dump: MemoryDump, userId: string): Promise<void> {
  const db = await getDb();

  await db.transaction(async (tx) => {
    for (const [entityId, bundle] of Object.entries(dump.entities)) {
      if (bundle.facts && bundle.facts.length > 0) {
        await tx
          .insert(llmWikiEntries)
          .values(
            bundle.facts.map((f) => ({
              id: f.id,
              entityId,
              userId,
              title: f.title,
              body: f.body,
              confidence: f.confidence,
              tags: f.tags,
              sourceRef: f.source_ref ?? null,
              sourceHash: f.source_hash ?? null,
              sourceType: f.source_type ?? "agent_inferred",
              lastAccessedAt: f.last_accessed_at ?? null,
              accessCount: f.access_count ?? 0,
              createdAt: f.created_at,
              updatedAt: f.updated_at,
              deletedAt: f.deleted_at ?? null,
            }))
          )
          .onConflictDoUpdate({
            target: [llmWikiEntries.id, llmWikiEntries.userId],
            set: {
              title: sql`excluded.title`,
              body: sql`excluded.body`,
              confidence: sql`excluded.confidence`,
              tags: sql`excluded.tags`,
              sourceRef: sql`excluded.source_ref`,
              sourceHash: sql`excluded.source_hash`,
              sourceType: sql`excluded.source_type`,
              lastAccessedAt: sql`excluded.last_accessed_at`,
              accessCount: sql`excluded.access_count`,
              updatedAt: sql`excluded.updated_at`,
              deletedAt: sql`excluded.deleted_at`,
            },
            where: sql`excluded.updated_at > ${llmWikiEntries.updatedAt}`,
          });
      }

      if (bundle.tasks && bundle.tasks.length > 0) {
        await tx
          .insert(llmWikiTasks)
          .values(
            bundle.tasks.map((t) => ({
              id: t.id,
              entityId,
              userId,
              description: t.description,
              status: t.status,
              priority: t.priority,
              createdAt: t.created_at,
              updatedAt: t.updated_at,
              resolvedAt: t.resolved_at ?? null,
              deletedAt: t.deleted_at ?? null,
            }))
          )
          .onConflictDoUpdate({
            target: [llmWikiTasks.id, llmWikiTasks.userId],
            set: {
              description: sql`excluded.description`,
              status: sql`excluded.status`,
              priority: sql`excluded.priority`,
              updatedAt: sql`excluded.updated_at`,
              resolvedAt: sql`excluded.resolved_at`,
              deletedAt: sql`excluded.deleted_at`,
            },
            where: sql`excluded.updated_at > ${llmWikiTasks.updatedAt}`,
          });
      }

      if (bundle.events && bundle.events.length > 0) {
        await tx
          .insert(llmWikiEvents)
          .values(
            bundle.events.map((e) => ({
              id: e.id,
              entityId,
              userId,
              eventType: e.event_type,
              summary: e.summary,
              createdAt: e.created_at,
            }))
          )
          .onConflictDoNothing();
      }
    }
  });
}

export const wikiSyncHandler = async (
  request: CallableRequest,
  options: WikiSyncOptions = {}
): Promise<{remoteDump: MemoryDump}> => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const decoded: DecodedIdToken = request.auth.token as DecodedIdToken;
  if (!decoded || decoded.uid !== request.auth.uid) {
    throw new HttpsError("unauthenticated", "Invalid Firebase authentication token.");
  }

  const email = decoded.email;
  if (!email) {
    throw new HttpsError("failed-precondition", "Firebase user email is required.");
  }

  const dump = parseInput(request.data);

  const getUser = options.getUser ?? ((args) => userRepository.getOrCreateUserByFirebaseIdentity(args));
  const getSubscription = options.getSubscription ?? ((userId) => subscriptionService.getSubscription(userId));

  let user: Awaited<ReturnType<typeof userRepository.getOrCreateUserByFirebaseIdentity>>;
  try {
    user = await getUser({
      firebaseUid: request.auth.uid,
      email,
      displayName: decoded.name || null,
      avatarUrl: decoded.picture || null,
    });
  } catch (error: unknown) {
    logger.error("Failed to bootstrap user in wikiSync", {firebaseUid: request.auth.uid, error});
    throw new HttpsError("internal", "Failed to bootstrap user.");
  }

  const subscription = await getSubscription(user.id);
  const isUnlimited =
    PREMIUM_TIERS.has(subscription?.planTier ?? "") && subscription?.planStatus === "active";

  if (!isUnlimited) {
    throw new HttpsError("permission-denied", "Wiki sync requires an active unlimited subscription.");
  }

  // Validate that every entity in the dump belongs to this user and is saved to cloud.
  const entityIds = Object.keys(dump.entities);
  if (entityIds.length > 0) {
    if (options.validateEntityOwnership) {
      await options.validateEntityOwnership(entityIds, user.id);
    } else {
      const db = await getDb();
      const ownedChars = await db
        .select({ id: characters.id })
        .from(characters)
        .where(and(
          inArray(characters.id, entityIds),
          eq(characters.userId, user.id),
          eq(characters.saveToCloud, true),
        ));
      const ownedIds = new Set(ownedChars.map((c) => c.id));
      for (const entityId of entityIds) {
        if (!ownedIds.has(entityId)) {
          throw new HttpsError("permission-denied", "One or more entities do not belong to this user.");
        }
      }
    }
  }

  try {
    if (options.upsertData) {
      await options.upsertData(dump, user.id);
    } else if (options.upsertEntries) {
      const allFacts = Object.values(dump.entities).flatMap((b) => b.facts ?? []);
      await options.upsertEntries(allFacts, user.id);
    } else {
      await upsertWikiData(dump, user.id);
    }
  } catch (error) {
    logger.error("wikiSync upsert failed", {userId: user.id, entityIds, error});
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", "Failed to sync wiki data.");
  }

  const remoteDump = options.fetchMergedDump
    ? await options.fetchMergedDump(entityIds, user.id)
    : entityIds.length > 0
      ? await fetchMergedDump(entityIds, user.id)
      : {generatedAt: Date.now(), entities: {}};

  return {remoteDump};
};

export const wikiSync = onCall(
  {
    region: DEFAULT_REGION,
    enforceAppCheck: true,
    invoker: "public",
    secrets: [...CLOUD_SQL_SECRETS],
  },
  (request) => wikiSyncHandler(request)
);
