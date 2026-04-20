import {onCall, CallableRequest, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import admin from "firebase-admin";
import {count, desc, eq, ilike, inArray, or} from "drizzle-orm";
import {requireAdmin} from "./adminAuth.js";
import {getDb} from "./db/cloudSql.js";
import {users, subscriptions, characters, messages} from "./db/schema.js";

if (!admin.apps.length) {
  admin.initializeApp();
}

const DEFAULT_RESET_CREDITS = 50;
const MAX_SAFE_DB_CREDITS = 2_147_483_647;
const ALLOWED_PLAN_TIERS = new Set(["free", "monthly_20", "monthly_50", "payg"]);
const ALLOWED_PLAN_STATUS = new Set(["active", "cancelled", "expired"]);

interface AdminListUsersData {
  page?: number;
  pageSize?: number;
  search?: string;
  planTier?: string;
  planStatus?: string;
}

interface AdminMutationData {
  userId: string;
  reason?: string;
  requestId: string;
}

interface SetCreditsData extends AdminMutationData {
  credits: number;
}

interface SetSubscriptionData extends AdminMutationData {
  planTier: string;
  planStatus: string;
  renewalDate?: string | null;
}

function assertRequestId(requestId: unknown): string {
  if (typeof requestId !== "string" || requestId.trim().length < 8) {
    throw new HttpsError(
      "invalid-argument",
      "requestId must be a non-empty string with at least 8 characters."
    );
  }
  return requestId.trim();
}

function assertUserId(userId: unknown): string {
  if (typeof userId !== "string" || userId.trim().length === 0) {
    throw new HttpsError("invalid-argument", "userId is required.");
  }
  return userId.trim();
}

function assertReason(reason: unknown): string {
  if (typeof reason !== "string" || reason.trim().length === 0) {
    throw new HttpsError("invalid-argument", "reason must be a non-empty string.");
  }
  return reason.trim();
}

function parseRenewalDate(value: unknown): Date | null {
  if (value == null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new HttpsError("invalid-argument", "renewalDate must be a string or null.");
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const isoUtcPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
  if (!isoUtcPattern.test(trimmed)) {
    throw new HttpsError("invalid-argument", "renewalDate must be a valid ISO date/time string.");
  }

  const parsedDate = new Date(trimmed);
  if (Number.isNaN(parsedDate.getTime())) {
    throw new HttpsError("invalid-argument", "renewalDate must be a valid ISO date/time string.");
  }

  return parsedDate;
}

function normalizePlanTier(value: unknown): "free" | "monthly_20" | "monthly_50" | "payg" {
  if (typeof value === "string" && ALLOWED_PLAN_TIERS.has(value)) {
    return value as "free" | "monthly_20" | "monthly_50" | "payg";
  }
  return "free";
}

function normalizePlanStatus(value: unknown): "active" | "cancelled" | "expired" {
  if (typeof value === "string" && ALLOWED_PLAN_STATUS.has(value)) {
    return value as "active" | "cancelled" | "expired";
  }
  return "active";
}

function normalizeCurrentCredits(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return Math.floor(parsed);
}

function auditLog(
  actorUid: string,
  actorEmail: string | null,
  targetUserId: string,
  action: string,
  requestId: string,
  payloadSummary: Record<string, unknown>
): void {
  logger.info("admin_audit_event", {
    actorUid,
    actorEmail,
    targetUserId,
    action,
    requestId,
    payloadSummary,
    timestamp: new Date().toISOString(),
  });
}

async function getUserById(userId: string) {
  const db = await getDb();
  const result = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return result[0] ?? null;
}

async function getUserByFirebaseUid(firebaseUid: string) {
  const db = await getDb();
  const result = await db
    .select()
    .from(users)
    .where(eq(users.firebaseUid, firebaseUid))
    .limit(1);
  return result[0] ?? null;
}

async function getSubscription(userId: string) {
  const db = await getDb();
  const result = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .limit(1);
  return result[0] ?? null;
}

async function upsertSubscription(
  userId: string,
  patch: Partial<typeof subscriptions.$inferInsert>
): Promise<void> {
  const db = await getDb();
  await db
    .insert(subscriptions)
    .values({
      userId,
      planTier: "free",
      planStatus: "active",
      currentCredits: 0,
      ...patch,
    })
    .onConflictDoUpdate({
      target: subscriptions.userId,
      set: {
        ...patch,
        updatedAt: new Date(),
      },
    });
}

async function deleteFirebaseAuthUser(firebaseUid: string, logContext: Record<string, unknown>): Promise<void> {
  try {
    await admin.auth().deleteUser(firebaseUid);
  } catch (error) {
    const code =
      typeof error === "object" && error && "code" in error
        ? String((error as {code?: unknown}).code)
        : "";
    if (code === "auth/user-not-found") {
      logger.info("Firebase auth user already deleted", {firebaseUid, ...logContext});
      return;
    }

    logger.error("Failed to delete Firebase auth user", {
      firebaseUid,
      ...logContext,
      error,
    });
    throw new HttpsError("internal", "Failed to delete Firebase auth user.");
  }
}

const adminListUsersHandler = async (request: CallableRequest) => {
  const adminContext = requireAdmin(request);
  const data = (request.data ?? {}) as AdminListUsersData;

  const rawPage = data.page;
  if (rawPage !== undefined && (typeof rawPage !== "number" || !Number.isFinite(rawPage))) {
    throw new HttpsError("invalid-argument", "page must be a finite number when provided");
  }

  const rawPageSize = data.pageSize;
  if (
    rawPageSize !== undefined &&
    (typeof rawPageSize !== "number" || !Number.isFinite(rawPageSize))
  ) {
    throw new HttpsError("invalid-argument", "pageSize must be a finite number when provided");
  }

  const page = rawPage === undefined ? 1 : Math.max(1, Math.floor(rawPage));
  const pageSize = rawPageSize === undefined
    ? 25
    : Math.min(100, Math.max(1, Math.floor(rawPageSize)));
  const search = typeof data.search === "string" ? data.search.trim() : "";

  const rawPlanTierFilter =
    typeof data.planTier === "string" ? data.planTier.trim().toLowerCase() : undefined;
  const planTierFilter =
    rawPlanTierFilter && ALLOWED_PLAN_TIERS.has(rawPlanTierFilter) ? rawPlanTierFilter : undefined;

  const rawPlanStatusFilter =
    typeof data.planStatus === "string" ? data.planStatus.trim().toLowerCase() : undefined;
  const planStatusFilter =
    rawPlanStatusFilter && ALLOWED_PLAN_STATUS.has(rawPlanStatusFilter) ?
      rawPlanStatusFilter :
      undefined;

  const db = await getDb();

  const searchClause = search.length > 0 ?
    or(
      ilike(users.email, `%${search}%`),
      ilike(users.displayName, `%${search}%`),
      ilike(users.firebaseUid, `%${search}%`)
    ) :
    undefined;

  const userRows = await db
    .select()
    .from(users)
    .where(searchClause)
    .orderBy(desc(users.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const totalResult = await db
    .select({value: count()})
    .from(users)
    .where(searchClause);
  const totalCount = Number(totalResult[0]?.value ?? 0);

  const userIds = userRows.map((row) => row.id);
  const subscriptionRows = userIds.length > 0 ?
    await db
      .select()
      .from(subscriptions)
      .where(inArray(subscriptions.userId, userIds)) :
    [];

  const subscriptionsByUserId = new Map(
    subscriptionRows.map((row) => [row.userId, row])
  );

  const hydratedUsers = userRows.map((row) => {
    const subscription = subscriptionsByUserId.get(row.id);
    const planTier = normalizePlanTier(subscription?.planTier);
    const planStatus = normalizePlanStatus(subscription?.planStatus);

    return {
      userId: row.id,
      email: row.email,
      createdAt: row.createdAt?.toISOString?.() ?? row.createdAt ?? null,
      planTier,
      planStatus,
      currentCredits: normalizeCurrentCredits(subscription?.currentCredits),
      termsAcceptedAt: subscription?.termsAcceptedAt?.toISOString?.() ?? null,
      termsVersion: subscription?.termsVersion ?? null,
    };
  });

  const filtered = hydratedUsers.filter((row) => {
    if (planTierFilter && row.planTier !== planTierFilter) {
      return false;
    }

    if (planStatusFilter && row.planStatus !== planStatusFilter) {
      return false;
    }

    return true;
  });

  logger.info("admin_list_users", {
    actorUid: adminContext.actorUid,
    actorEmail: adminContext.actorEmail,
    page,
    pageSize,
    search,
    resultCount: filtered.length,
    totalCount,
  });

  return {
    success: true,
    users: filtered,
    page,
    pageSize,
    totalCount,
    hasMore: page * pageSize < totalCount,
  };
};

const adminSetUserCreditsHandler = async (request: CallableRequest) => {
  const adminContext = requireAdmin(request);
  const data = (request.data ?? {}) as SetCreditsData;

  const userId = assertUserId(data.userId);
  const reason = assertReason(data.reason);
  const requestId = assertRequestId(data.requestId);

  if (!Number.isFinite(data.credits) || data.credits < 0) {
    throw new HttpsError("invalid-argument", "credits must be a number >= 0.");
  }

  if (data.credits > MAX_SAFE_DB_CREDITS) {
    throw new HttpsError(
      "invalid-argument",
      `credits must be <= ${MAX_SAFE_DB_CREDITS}.`
    );
  }

  const user = await getUserById(userId);
  if (!user) {
    throw new HttpsError("not-found", "User not found.");
  }

  const credits = Math.floor(data.credits);
  await upsertSubscription(userId, {
    currentCredits: credits,
  });

  auditLog(adminContext.actorUid, adminContext.actorEmail, userId, "set_credits", requestId, {
    credits,
    reason,
  });

  return {
    success: true,
    action: "adminSetUserCredits",
    targetUserId: userId,
    requestId,
    applied: {currentCredits: credits},
  };
};

const adminSetUserSubscriptionHandler = async (request: CallableRequest) => {
  const adminContext = requireAdmin(request);
  const data = (request.data ?? {}) as SetSubscriptionData;

  const userId = assertUserId(data.userId);
  const reason = assertReason(data.reason);
  const requestId = assertRequestId(data.requestId);
  const planTier = typeof data.planTier === "string" ? data.planTier : "";
  const planStatus = typeof data.planStatus === "string" ? data.planStatus : "";

  if (!ALLOWED_PLAN_TIERS.has(planTier)) {
    throw new HttpsError("invalid-argument", "Invalid plan tier.");
  }

  if (!ALLOWED_PLAN_STATUS.has(planStatus)) {
    throw new HttpsError("invalid-argument", "Invalid plan status.");
  }

  const hasRenewalDate = Object.prototype.hasOwnProperty.call(data, "renewalDate");
  const renewalDate = hasRenewalDate ? parseRenewalDate(data.renewalDate) : undefined;

  const user = await getUserById(userId);
  if (!user) {
    throw new HttpsError("not-found", "User not found.");
  }

  const patch: Partial<typeof subscriptions.$inferInsert> = {
    planTier: normalizePlanTier(planTier),
    planStatus: normalizePlanStatus(planStatus),
  };

  const applied: Record<string, unknown> = {
    planTier,
    planStatus,
  };

  if (hasRenewalDate) {
    patch.billingCycleEnd = renewalDate;
    applied.renewalDate = renewalDate ? renewalDate.toISOString() : null;
  }

  await upsertSubscription(userId, patch);

  auditLog(
    adminContext.actorUid,
    adminContext.actorEmail,
    userId,
    "set_subscription",
    requestId,
    {
      ...applied,
      reason,
    }
  );

  return {
    success: true,
    action: "adminSetUserSubscription",
    targetUserId: userId,
    requestId,
    applied,
  };
};

const adminClearTermsAcceptanceHandler = async (request: CallableRequest) => {
  const adminContext = requireAdmin(request);
  const data = (request.data ?? {}) as AdminMutationData;

  const userId = assertUserId(data.userId);
  const reason = assertReason(data.reason);
  const requestId = assertRequestId(data.requestId);

  const existingSubscription = await getSubscription(userId);
  if (!existingSubscription) {
    throw new HttpsError(
      "failed-precondition",
      "Cannot clear terms acceptance because no subscription exists for this user."
    );
  }

  const db = await getDb();
  await db
    .update(subscriptions)
    .set({
      termsAcceptedAt: null,
      termsVersion: null,
      updatedAt: new Date(),
    })
    .where(eq(subscriptions.userId, userId));

  auditLog(
    adminContext.actorUid,
    adminContext.actorEmail,
    userId,
    "clear_terms_acceptance",
    requestId,
    {reason}
  );

  return {
    success: true,
    action: "adminClearTermsAcceptance",
    targetUserId: userId,
    requestId,
    applied: {termsAcceptedAt: null, termsVersion: null},
  };
};

const adminResetUserStateHandler = async (request: CallableRequest) => {
  const adminContext = requireAdmin(request);
  const data = (request.data ?? {}) as AdminMutationData;

  const userId = assertUserId(data.userId);
  const reason = assertReason(data.reason);
  const requestId = assertRequestId(data.requestId);

  const user = await getUserById(userId);
  if (!user) {
    throw new HttpsError("not-found", "User not found.");
  }

  const db = await getDb();

  await db
    .delete(messages)
    .where(eq(messages.senderUserId, userId));

  await db
    .delete(characters)
    .where(eq(characters.userId, userId));

  await upsertSubscription(userId, {
    planTier: "free",
    planStatus: "active",
    billingCycleEnd: null,
    currentCredits: DEFAULT_RESET_CREDITS,
    termsAcceptedAt: null,
    termsVersion: null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
  });

  auditLog(adminContext.actorUid, adminContext.actorEmail, userId, "reset_user_state", requestId, {
    reason,
    resetCredits: DEFAULT_RESET_CREDITS,
  });

  return {
    success: true,
    action: "adminResetUserState",
    targetUserId: userId,
    requestId,
    applied: {
      planTier: "free",
      planStatus: "active",
      currentCredits: DEFAULT_RESET_CREDITS,
      termsAcceptedAt: null,
      termsVersion: null,
    },
  };
};

const adminDeleteUserHandler = async (request: CallableRequest) => {
  const adminContext = requireAdmin(request);
  const data = (request.data ?? {}) as AdminMutationData;

  const userId = assertUserId(data.userId);
  const reason = assertReason(data.reason);
  const requestId = assertRequestId(data.requestId);

  const user = await getUserById(userId);
  if (!user) {
    throw new HttpsError("not-found", "User not found.");
  }

  await deleteFirebaseAuthUser(user.firebaseUid, {userId});

  const db = await getDb();
  await db
    .delete(users)
    .where(eq(users.id, userId));

  auditLog(adminContext.actorUid, adminContext.actorEmail, userId, "delete_user", requestId, {
    reason,
    firebaseUid: user.firebaseUid,
  });

  return {
    success: true,
    action: "adminDeleteUser",
    targetUserId: userId,
    requestId,
    applied: {deleted: true},
  };
};

const deleteMyAccountHandler = async (request: CallableRequest) => {
  const auth = request.auth;
  if (!auth?.uid) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const firebaseUid = auth.uid;

  const user = await getUserByFirebaseUid(firebaseUid);
  if (user) {
    const db = await getDb();
    await db
      .delete(users)
      .where(eq(users.id, user.id));
  }

  await deleteFirebaseAuthUser(firebaseUid, {userId: user?.id ?? null});

  logger.info("self_service_delete_account", {
    firebaseUid,
    userId: user?.id ?? null,
    deleted: true,
    timestamp: new Date().toISOString(),
  });

  return {
    success: true,
    deleted: true,
    userId: user?.id ?? null,
  };
};

export {
  adminListUsersHandler,
  adminSetUserCreditsHandler,
  adminSetUserSubscriptionHandler,
  adminClearTermsAcceptanceHandler,
  adminResetUserStateHandler,
  adminDeleteUserHandler,
  deleteMyAccountHandler,
};

const sharedCallableOptions = {
  region: "us-central1" as const,
  enforceAppCheck: true,
  invoker: "public" as const,
};

export const adminListUsers = onCall(sharedCallableOptions, (request) => adminListUsersHandler(request));

export const adminSetUserCredits = onCall(sharedCallableOptions, (request) =>
  adminSetUserCreditsHandler(request)
);

export const adminSetUserSubscription = onCall(sharedCallableOptions, (request) =>
  adminSetUserSubscriptionHandler(request)
);

export const adminClearTermsAcceptance = onCall(sharedCallableOptions, (request) =>
  adminClearTermsAcceptanceHandler(request)
);

export const adminResetUserState = onCall(sharedCallableOptions, (request) =>
  adminResetUserStateHandler(request)
);

export const adminDeleteUser = onCall(sharedCallableOptions, (request) =>
  adminDeleteUserHandler(request)
);

export const deleteMyAccount = onCall(sharedCallableOptions, (request) =>
  deleteMyAccountHandler(request)
);
