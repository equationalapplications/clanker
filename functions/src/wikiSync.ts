import {onCall, HttpsError, CallableRequest} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import type {DecodedIdToken} from "firebase-admin/auth";
import {CLOUD_SQL_SECRETS} from "./cloudSqlSecrets.js";
import {userRepository} from "./services/userRepository.js";
import {subscriptionService} from "./services/subscriptionService.js";
import {getDb} from "./db/cloudSql.js";
import {wikiEntries, wikiTasks, wikiEvents} from "./db/schema.js";
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
}

function parseInput(data: unknown): MemoryDump {
  if (!data || typeof data !== "object") {
    throw new HttpsError("invalid-argument", "Request body must be an object.");
  }

  const d = data as Record<string, unknown>;
  if (!d.dump || typeof d.dump !== "object") {
    throw new HttpsError("invalid-argument", "dump is required.");
  }

  const dump = d.dump as MemoryDump;
  if (!dump.entities || typeof dump.entities !== "object") {
    throw new HttpsError("invalid-argument", "dump.entities is required.");
  }

  return dump;
}

async function upsertWikiData(dump: MemoryDump, userId: string): Promise<void> {
  const db = await getDb();

  for (const [entityId, bundle] of Object.entries(dump.entities)) {
    if (bundle.facts && bundle.facts.length > 0) {
      for (const f of bundle.facts) {
        const row = {
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
        };
        await db
          .insert(wikiEntries)
          .values(row)
          .onConflictDoUpdate({
            target: wikiEntries.id,
            set: {
              title: row.title,
              body: row.body,
              confidence: row.confidence,
              tags: row.tags,
              sourceRef: row.sourceRef,
              sourceHash: row.sourceHash,
              updatedAt: row.updatedAt,
            },
          });
      }
    }

    if (bundle.tasks && bundle.tasks.length > 0) {
      for (const t of bundle.tasks) {
        await db
          .insert(wikiTasks)
          .values({
            id: t.id,
            entityId,
            userId,
            description: t.description,
            status: t.status,
            priority: t.priority,
            createdAt: t.created_at,
            updatedAt: t.updated_at,
            resolvedAt: t.resolved_at ?? null,
          })
          .onConflictDoUpdate({
            target: wikiTasks.id,
            set: {
              description: t.description,
              status: t.status,
              priority: t.priority,
              updatedAt: t.updated_at,
              resolvedAt: t.resolved_at ?? null,
            },
          });
      }
    }

    if (bundle.events && bundle.events.length > 0) {
      for (const e of bundle.events) {
        await db
          .insert(wikiEvents)
          .values({
            id: e.id,
            entityId,
            userId,
            eventType: e.event_type,
            summary: e.summary,
            createdAt: e.created_at,
          })
          .onConflictDoNothing();
      }
    }
  }
}

export const wikiSyncHandler = async (
  request: CallableRequest,
  options: WikiSyncOptions = {}
): Promise<{ok: boolean}> => {
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

  let user: Awaited<ReturnType<typeof userRepository.getOrCreateUserByFirebaseIdentity>>;
  try {
    user = await userRepository.getOrCreateUserByFirebaseIdentity({
      firebaseUid: request.auth.uid,
      email,
      displayName: decoded.name || null,
      avatarUrl: decoded.picture || null,
    });
  } catch (error: unknown) {
    logger.error("Failed to bootstrap user in wikiSync", {firebaseUid: request.auth.uid, error});
    throw new HttpsError("internal", "Failed to bootstrap user.");
  }

  const subscription = await subscriptionService.getSubscription(user.id);
  const isUnlimited =
    PREMIUM_TIERS.has(subscription?.planTier ?? "") && subscription?.planStatus === "active";

  if (!isUnlimited) {
    throw new HttpsError("permission-denied", "Wiki sync requires an active unlimited subscription.");
  }

  try {
    if (options.upsertEntries) {
      const allFacts = Object.values(dump.entities).flatMap((b) => b.facts ?? []);
      await options.upsertEntries(allFacts, user.id);
    } else {
      await upsertWikiData(dump, user.id);
    }
  } catch (error) {
    logger.error("wikiSync upsert failed", {userId: user.id, error});
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", "Failed to sync wiki data.");
  }

  return {ok: true};
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
