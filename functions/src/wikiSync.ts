import {onCall, HttpsError, CallableRequest} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import type {DecodedIdToken} from "firebase-admin/auth";
import {inArray, and, eq, sql} from "drizzle-orm";
import {CLOUD_SQL_SECRETS} from "./cloudSqlSecrets.js";
import {userRepository} from "./services/userRepository.js";
import {subscriptionService} from "./services/subscriptionService.js";
import {getDb} from "./db/cloudSql.js";
import {wikiEntries, wikiTasks, wikiEvents, characters} from "./db/schema.js";
import {PREMIUM_TIERS} from "./constants/plans.js";

const DEFAULT_REGION = "us-central1";

interface WikiFact {
  id: string;
  entity_id: string;
  title: string;
  body: string;
  confidence: string;
  tags: string[];
  source_ref?: string | null;
  source_hash?: string | null;
  created_at: number;
  updated_at: number;
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

interface MemoryDump {
  generatedAt: number;
  entities: Record<string, MemoryBundle>;
}

interface WikiSyncOptions {
  upsertEntries?: (entries: WikiFact[], userId: string) => Promise<void>;
  validateEntityOwnership?: (entityIds: string[], userId: string) => Promise<void>;
  fetchMergedDump?: (entityIds: string[], userId: string) => Promise<MemoryDump>;
  getUser?: typeof userRepository.getOrCreateUserByFirebaseIdentity;
  getSubscription?: typeof subscriptionService.getSubscription;
}

const MAX_ENTITIES = 50;

function parseInput(data: unknown): MemoryDump {
  if (!data || typeof data !== "object") {
    throw new HttpsError("invalid-argument", "Request body must be an object.");
  }

  const d = data as Record<string, unknown>;
  if (!d.dump || typeof d.dump !== "object") {
    throw new HttpsError("invalid-argument", "dump is required.");
  }

  const rawDump = d.dump as Record<string, unknown>;
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
  }

  return d.dump as unknown as MemoryDump;
}

async function fetchMergedDump(entityIds: string[], userId: string): Promise<MemoryDump> {
  if (entityIds.length === 0) {
    return {generatedAt: Date.now(), entities: {}};
  }
  const db = await getDb();

  const [allFacts, allTasks, allEvents] = await Promise.all([
    db.select().from(wikiEntries).where(
      and(inArray(wikiEntries.entityId, entityIds), eq(wikiEntries.userId, userId))
    ),
    db.select().from(wikiTasks).where(
      and(inArray(wikiTasks.entityId, entityIds), eq(wikiTasks.userId, userId))
    ),
    db.select().from(wikiEvents).where(
      and(inArray(wikiEvents.entityId, entityIds), eq(wikiEvents.userId, userId))
    ),
  ]);

  const entities: Record<string, MemoryBundle> = {};
  for (const entityId of entityIds) {
    entities[entityId] = {
      facts: allFacts
        .filter((r) => r.entityId === entityId)
        .map((r) => ({
          id: r.id,
          entity_id: r.entityId,
          title: r.title,
          body: r.body,
          confidence: r.confidence,
          tags: r.tags as string[],
          source_ref: r.sourceRef ?? null,
          source_hash: r.sourceHash ?? null,
          created_at: r.createdAt,
          updated_at: r.updatedAt,
        })),
      tasks: allTasks
        .filter((r) => r.entityId === entityId)
        .map((r) => ({
          id: r.id,
          entity_id: r.entityId,
          description: r.description,
          status: r.status,
          priority: r.priority,
          created_at: r.createdAt,
          updated_at: r.updatedAt,
          resolved_at: r.resolvedAt ?? null,
        })),
      events: allEvents
        .filter((r) => r.entityId === entityId)
        .map((r) => ({
          id: r.id,
          entity_id: r.entityId,
          event_type: r.eventType,
          summary: r.summary,
          created_at: r.createdAt,
        })),
    };
  }

  return {generatedAt: Date.now(), entities};
}

async function upsertWikiData(dump: MemoryDump, userId: string): Promise<void> {
  const db = await getDb();

  await db.transaction(async (tx) => {
    for (const [entityId, bundle] of Object.entries(dump.entities)) {
      if (bundle.facts && bundle.facts.length > 0) {
        await tx
          .insert(wikiEntries)
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
              createdAt: f.created_at,
              updatedAt: f.updated_at,
            }))
          )
          .onConflictDoUpdate({
            target: [wikiEntries.id, wikiEntries.userId],
            set: {
              title: sql`excluded.title`,
              body: sql`excluded.body`,
              confidence: sql`excluded.confidence`,
              tags: sql`excluded.tags`,
              sourceRef: sql`excluded.source_ref`,
              sourceHash: sql`excluded.source_hash`,
              updatedAt: sql`excluded.updated_at`,
            },
            where: sql`excluded.updated_at > ${wikiEntries.updatedAt}`,
          });
      }

      if (bundle.tasks && bundle.tasks.length > 0) {
        await tx
          .insert(wikiTasks)
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
            }))
          )
          .onConflictDoUpdate({
            target: [wikiTasks.id, wikiTasks.userId],
            set: {
              description: sql`excluded.description`,
              status: sql`excluded.status`,
              priority: sql`excluded.priority`,
              updatedAt: sql`excluded.updated_at`,
              resolvedAt: sql`excluded.resolved_at`,
            },
            where: sql`excluded.updated_at > ${wikiTasks.updatedAt}`,
          });
      }

      if (bundle.events && bundle.events.length > 0) {
        await tx
          .insert(wikiEvents)
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
    if (options.upsertEntries) {
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
