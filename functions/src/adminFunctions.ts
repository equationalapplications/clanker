import {onCall, CallableRequest, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import admin from "firebase-admin";
import {getSupabaseUrl} from "./runtimeConfig.js";
import {requireAdmin} from "./adminAuth.js";

if (!admin.apps.length) {
  admin.initializeApp();
}

const APP_NAME = "clanker";
const DEFAULT_RESET_CREDITS = 50;
const MAX_SAFE_DB_CREDITS = 2_147_483_647;
const ALLOWED_PLAN_TIERS = new Set(["free", "monthly_20", "monthly_50", "payg"]);
const ALLOWED_PLAN_STATUS = new Set(["active", "cancelled", "expired"]);
const UNKNOWN_PLAN_VALUE = "unknown";

function normalizePlanTier(value: unknown): string {
  if (typeof value === "string" && ALLOWED_PLAN_TIERS.has(value)) {
    return value;
  }
  return UNKNOWN_PLAN_VALUE;
}

function normalizePlanStatus(value: unknown): string {
  if (typeof value === "string" && ALLOWED_PLAN_STATUS.has(value)) {
    return value;
  }
  return UNKNOWN_PLAN_VALUE;
}

function normalizeWritablePlanTier(value: unknown): string {
  const normalized = normalizePlanTier(value);
  return normalized === UNKNOWN_PLAN_VALUE ? "free" : normalized;
}

function normalizeWritablePlanStatus(value: unknown): string {
  const normalized = normalizePlanStatus(value);
  return normalized === UNKNOWN_PLAN_VALUE ? "active" : normalized;
}

function normalizeCurrentCredits(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return Math.floor(parsed);
}

function parseRenewalDate(value: unknown): string | null {
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

  const normalized = parsedDate.toISOString();
  if (trimmed !== normalized && trimmed !== normalized.replace(".000Z", "Z")) {
    throw new HttpsError("invalid-argument", "renewalDate must be a valid ISO date/time string.");
  }

  return normalized;
}

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

function getSupabaseServiceRoleKey(): string | undefined {
  return process.env.SUPABASE_SERVICE_ROLE_KEY;
}

function assertSupabaseConfig(): {supabaseUrl: string; serviceKey: string} {
  const supabaseUrl = getSupabaseUrl();
  const serviceKey = getSupabaseServiceRoleKey();

  if (!supabaseUrl || !serviceKey) {
    throw new HttpsError(
      "failed-precondition",
      "Missing SUPABASE_SERVICE_ROLE_KEY or SUPABASE_URL."
    );
  }

  return {supabaseUrl: supabaseUrl.replace(/\/+$/, ""), serviceKey};
}

async function supabaseRequest(
  path: string,
  init: RequestInit = {},
  headers: Record<string, string> = {}
): Promise<Response> {
  const {supabaseUrl, serviceKey} = assertSupabaseConfig();
  const response = await fetch(`${supabaseUrl}${path}`, {
    ...init,
    headers: {
      "Authorization": `Bearer ${serviceKey}`,
      "apikey": serviceKey,
      "Content-Type": "application/json",
      ...headers,
    },
  });

  return response;
}

async function parseJsonSafe<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
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

async function getSubscriptionRow(userId: string): Promise<Record<string, unknown> | null> {
  const response = await supabaseRequest(
    `/rest/v1/user_app_subscriptions?user_id=eq.${encodeURIComponent(userId)}&app_name=eq.${APP_NAME}&select=*`
  );

  if (!response.ok) {
    const errorText = await response.text();
    logger.error("Failed to fetch user subscription", {userId, errorText});
    throw new HttpsError("internal", "Failed to fetch subscription.");
  }

  const rows = await parseJsonSafe<Array<Record<string, unknown>>>(response);
  return rows && rows.length > 0 ? rows[0] : null;
}

async function getSubscriptionRowsByUserIds(
  userIds: string[]
): Promise<Map<string, Record<string, unknown>>> {
  const uniqueUserIds = Array.from(new Set(userIds.filter((userId) => userId.length > 0)));
  if (uniqueUserIds.length === 0) {
    return new Map<string, Record<string, unknown>>();
  }

  const userIdFilter = `in.(${uniqueUserIds
    .map((userId) => `"${userId.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`)
    .join(",")})`;
  const params = new URLSearchParams({
    app_name: `eq.${APP_NAME}`,
    user_id: userIdFilter,
    select: "user_id,plan_tier,plan_status,current_credits,terms_accepted_at,terms_version",
  });

  const response = await supabaseRequest(`/rest/v1/user_app_subscriptions?${params.toString()}`);
  if (!response.ok) {
    const errorText = await response.text();
    logger.error("Failed to batch fetch user subscriptions", {errorText, userCount: uniqueUserIds.length});
    throw new HttpsError("internal", "Failed to fetch user subscriptions.");
  }

  const rows = await parseJsonSafe<Array<Record<string, unknown>>>(response);
  const byUserId = new Map<string, Record<string, unknown>>();
  for (const row of rows ?? []) {
    const rowUserId = typeof row.user_id === "string" ? row.user_id : "";
    if (rowUserId) {
      byUserId.set(rowUserId, row);
    }
  }

  return byUserId;
}

async function upsertSubscription(
  userId: string,
  fields: Record<string, unknown>
): Promise<void> {
  const response = await supabaseRequest(
    `/rest/v1/user_app_subscriptions?on_conflict=user_id,app_name`,
    {
      method: "POST",
      body: JSON.stringify({
        user_id: userId,
        app_name: APP_NAME,
        updated_at: new Date().toISOString(),
        ...fields,
      }),
    },
    {"Prefer": "resolution=merge-duplicates,return=representation"}
  );

  if (!response.ok) {
    const errorText = await response.text();
    logger.error("Failed to upsert user subscription", {userId, errorText});
    throw new HttpsError("internal", "Failed to update subscription.");
  }
}

function isMissingTableError(response: Response, errorText: string): boolean {
  if (response.status !== 404) {
    return false;
  }

  return errorText.includes("\"code\":\"PGRST205\"") ||
    errorText.includes("Could not find the table");
}

async function deleteFromCanonicalTable(
  tableName: string,
  query: string
): Promise<void> {
  const expectedPath = `/rest/v1/${tableName}`;
  const matchesExpectedTable = query === expectedPath ||
    query.startsWith(`${expectedPath}?`);

  if (!matchesExpectedTable) {
    logger.error("Mismatched canonical table delete query", {
      tableName,
      query,
      expectedPath,
    });
    throw new HttpsError(
      "internal",
      `Invalid delete query for canonical table ${tableName}.`
    );
  }

  const response = await supabaseRequest(query, {method: "DELETE"});
  if (response.ok) {
    return;
  }

  const errorText = await response.text();
  if (isMissingTableError(response, errorText)) {
    logger.error("Canonical table missing for admin delete operation", {
      tableName,
      errorText,
    });
    throw new HttpsError(
      "failed-precondition",
      `Database schema mismatch: expected canonical table ${tableName}.`
    );
  }

  logger.error("Failed canonical table delete request", {
    tableName,
    status: response.status,
    errorText,
  });

  throw new HttpsError("internal", `Failed to delete rows from ${tableName}.`);
}

async function deleteAppDataByUser(userId: string): Promise<void> {
  const [deleteMessages, deleteCharacters] = await Promise.allSettled([
    deleteFromCanonicalTable(
      "yours_brightly_messages",
      `/rest/v1/yours_brightly_messages?or=(sender_user_id.eq.${encodeURIComponent(userId)},recipient_user_id.eq.${encodeURIComponent(userId)})`
    ),
    deleteFromCanonicalTable(
      "yours_brightly_characters",
      `/rest/v1/yours_brightly_characters?user_id=eq.${encodeURIComponent(userId)}`
    ),
  ]);

  const failedOperations: string[] = [];
  const operationErrors: unknown[] = [];

  if (deleteMessages.status === "rejected") {
    failedOperations.push("messages");
    operationErrors.push(deleteMessages.reason);
    logger.error("Delete operation failed for user messages", {
      userId,
      error: deleteMessages.reason,
      errorMessage: deleteMessages.reason instanceof Error ?
        deleteMessages.reason.message :
        String(deleteMessages.reason),
    });
  }

  if (deleteCharacters.status === "rejected") {
    failedOperations.push("characters");
    operationErrors.push(deleteCharacters.reason);
    logger.error("Delete operation failed for user characters", {
      userId,
      error: deleteCharacters.reason,
      errorMessage: deleteCharacters.reason instanceof Error ?
        deleteCharacters.reason.message :
        String(deleteCharacters.reason),
    });
  }

  if (failedOperations.length > 0) {
    const propagatedError = operationErrors.find((error) => error instanceof HttpsError);
    if (propagatedError instanceof HttpsError) {
      throw propagatedError;
    }
    throw new HttpsError("internal", "Failed to delete all user app data.");
  }
}

async function deleteSubscriptionRows(userId: string): Promise<void> {
  const deleteResponse = await supabaseRequest(
    `/rest/v1/user_app_subscriptions?user_id=eq.${encodeURIComponent(userId)}&app_name=eq.${encodeURIComponent(APP_NAME)}`,
    {method: "DELETE"}
  );

  if (!deleteResponse.ok) {
    const errorText = await deleteResponse.text();
    logger.error("Failed to delete user subscriptions", {userId, errorText});
    throw new HttpsError("internal", "Failed to delete user subscriptions.");
  }
}

async function deleteSupabaseAuthUser(userId: string): Promise<void> {
  const response = await supabaseRequest(`/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    if (response.status === 404) {
      logger.info("Supabase auth user already deleted", {userId});
      return;
    }
    const errorText = await response.text();
    logger.error("Failed to delete Supabase auth user", {userId, errorText});
    throw new HttpsError("internal", "Failed to delete Supabase auth user.");
  }
}

async function getSupabaseAuthUser(userId: string): Promise<Record<string, unknown> | null> {
  const response = await supabaseRequest(`/auth/v1/admin/users/${encodeURIComponent(userId)}`);

  if (!response.ok) {
    if (response.status === 404) {
      logger.info("Supabase auth user not found", {userId});
      return null;
    }

    const errorText = await response.text();
    logger.error("Failed to fetch Supabase auth user", {userId, errorText});
    throw new HttpsError("internal", "Failed to fetch Supabase auth user.");
  }

  return parseJsonSafe<Record<string, unknown>>(response);
}

async function getSupabaseAuthUsers(
  page: number,
  pageSize: number,
  filter?: string
): Promise<{users: Array<Record<string, unknown>>; totalCount?: number}> {
  const params = new URLSearchParams({
    page: String(page),
    per_page: String(pageSize),
  });

  // Supabase GoTrue Admin API supports an undocumented "filter" query param.
  // Confirmed in GoTrue source: FindUsersInAudience applies email/full_name matching server-side.
  if (typeof filter === "string" && filter.trim().length > 0) {
    params.set("filter", filter.trim());
  }

  const response = await supabaseRequest(`/auth/v1/admin/users?${params.toString()}`);

  if (!response.ok) {
    const errorText = await response.text();
    logger.error("Failed to list users from Supabase auth admin", {errorText});
    throw new HttpsError("internal", "Failed to list users.");
  }

  const payload = await parseJsonSafe<{
    users?: Array<Record<string, unknown>>;
    count?: number;
    total?: number;
    totalCount?: number;
  }>(response);

  const responseCountCandidates = [payload?.count, payload?.total, payload?.totalCount];
  const totalCount = responseCountCandidates.find((value) =>
    typeof value === "number" && Number.isFinite(value)
  );

  return {
    users: payload?.users ?? [],
    totalCount,
  };
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
  const hasPlanTierFilter = data.planTier !== undefined;
  if (hasPlanTierFilter && typeof data.planTier !== "string") {
    logger.warn("Ignoring non-string planTier filter for adminListUsers", {
      actorUid: adminContext.actorUid,
      rawPlanTierType: typeof data.planTier,
    });
  }

  const rawPlanTierFilter = typeof data.planTier === "string" ? data.planTier.trim().toLowerCase() : undefined;
  const planTierFilter = rawPlanTierFilter && ALLOWED_PLAN_TIERS.has(rawPlanTierFilter) ?
    rawPlanTierFilter :
    undefined;
  if (rawPlanTierFilter && !planTierFilter) {
    logger.warn("Ignoring invalid planTier filter for adminListUsers", {
      actorUid: adminContext.actorUid,
      rawPlanTierFilter,
    });
  }

  const hasPlanStatusFilter = data.planStatus !== undefined;
  if (hasPlanStatusFilter && typeof data.planStatus !== "string") {
    logger.warn("Ignoring non-string planStatus filter for adminListUsers", {
      actorUid: adminContext.actorUid,
      rawPlanStatusType: typeof data.planStatus,
    });
  }

  const rawPlanStatusFilter = typeof data.planStatus === "string" ? data.planStatus.trim().toLowerCase() : undefined;
  const planStatusFilter = rawPlanStatusFilter && ALLOWED_PLAN_STATUS.has(rawPlanStatusFilter) ?
    rawPlanStatusFilter :
    undefined;
  if (rawPlanStatusFilter && !planStatusFilter) {
    logger.warn("Ignoring invalid planStatus filter for adminListUsers", {
      actorUid: adminContext.actorUid,
      rawPlanStatusFilter,
    });
  }

  const {users, totalCount} = await getSupabaseAuthUsers(page, pageSize, search);
  const userIds = users
    .map((user) => (typeof user.id === "string" ? user.id : ""))
    .filter((userId) => userId.length > 0);
  const subscriptionsByUserId = await getSubscriptionRowsByUserIds(userIds);

  const hydratedUsers = users.map((user) => {
    const userId = typeof user.id === "string" ? user.id : "";
    const subscription = userId ? subscriptionsByUserId.get(userId) : null;
    const planTier = normalizePlanTier(subscription?.plan_tier);
    const planStatus = normalizePlanStatus(subscription?.plan_status);
    const email =
      typeof user.email === "string"
        ? user.email
        : typeof user.phone === "string"
          ? user.phone
          : "unknown";

    if (subscription && planTier === UNKNOWN_PLAN_VALUE) {
      logger.warn("Unexpected plan_tier value in subscription row", {
        userId,
        rawPlanTier: subscription.plan_tier,
      });
    }

    if (subscription && planStatus === UNKNOWN_PLAN_VALUE) {
      logger.warn("Unexpected plan_status value in subscription row", {
        userId,
        rawPlanStatus: subscription.plan_status,
      });
    }

    return {
      userId,
      email,
      createdAt: user.created_at ?? null,
      planTier,
      planStatus,
      currentCredits: normalizeCurrentCredits(subscription?.current_credits),
      termsAcceptedAt: (subscription?.terms_accepted_at as string | null) ?? null,
      termsVersion: (subscription?.terms_version as string | null) ?? null,
    };
  });

  const filtered = hydratedUsers.filter((row) => {
    if (!row.userId) {
      return false;
    }

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

  const hasMore = typeof totalCount === "number" && Number.isFinite(totalCount)
    ? page * pageSize < totalCount
    : hydratedUsers.length === pageSize;

  return {
    success: true,
    users: filtered,
    page,
    pageSize,
    totalCount,
    hasMore,
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

  const credits = Math.floor(data.credits);
  const existingSubscription = await getSubscriptionRow(userId);
  const planTier = normalizeWritablePlanTier(existingSubscription?.plan_tier);
  const planStatus = normalizeWritablePlanStatus(existingSubscription?.plan_status);

  if (existingSubscription && planTier === "free" && existingSubscription.plan_tier !== "free") {
    logger.warn("Coercing unexpected plan_tier while updating credits", {
      userId,
      rawPlanTier: existingSubscription.plan_tier,
      coercedPlanTier: planTier,
    });
  }

  if (existingSubscription && planStatus === "active" && existingSubscription.plan_status !== "active") {
    logger.warn("Coercing unexpected plan_status while updating credits", {
      userId,
      rawPlanStatus: existingSubscription.plan_status,
      coercedPlanStatus: planStatus,
    });
  }

  await upsertSubscription(userId, {
    plan_tier: planTier,
    plan_status: planStatus,
    current_credits: credits,
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

  const updates: Record<string, unknown> = {
    plan_tier: planTier,
    plan_status: planStatus,
  };

  if (Object.prototype.hasOwnProperty.call(data, "renewalDate")) {
    updates.plan_renewal_at = parseRenewalDate(data.renewalDate);
  }

  await upsertSubscription(userId, updates);

  auditLog(
    adminContext.actorUid,
    adminContext.actorEmail,
    userId,
    "set_subscription",
    requestId,
    {
      planTier,
      planStatus,
      renewalDate: updates.plan_renewal_at,
      reason,
    }
  );

  return {
    success: true,
    action: "adminSetUserSubscription",
    targetUserId: userId,
    requestId,
    applied: {
      planTier,
      planStatus,
      ...(Object.prototype.hasOwnProperty.call(updates, "plan_renewal_at") ?
        {renewalDate: updates.plan_renewal_at} :
        {}),
    },
  };
};

const adminClearTermsAcceptanceHandler = async (request: CallableRequest) => {
  const adminContext = requireAdmin(request);
  const data = (request.data ?? {}) as AdminMutationData;

  const userId = assertUserId(data.userId);
  const reason = assertReason(data.reason);
  const requestId = assertRequestId(data.requestId);

  const existingSubscription = await getSubscriptionRow(userId);
  if (!existingSubscription) {
    throw new HttpsError(
      "failed-precondition",
      "Cannot clear terms acceptance because no subscription exists for this user."
    );
  }

  const planTier = normalizeWritablePlanTier(existingSubscription.plan_tier);
  const planStatus = normalizeWritablePlanStatus(existingSubscription.plan_status);

  if (planTier === "free" && existingSubscription.plan_tier !== "free") {
    logger.warn("Coercing unexpected plan_tier while clearing terms", {
      userId,
      rawPlanTier: existingSubscription.plan_tier,
      coercedPlanTier: planTier,
    });
  }

  if (planStatus === "active" && existingSubscription.plan_status !== "active") {
    logger.warn("Coercing unexpected plan_status while clearing terms", {
      userId,
      rawPlanStatus: existingSubscription.plan_status,
      coercedPlanStatus: planStatus,
    });
  }

  await upsertSubscription(userId, {
    plan_tier: planTier,
    plan_status: planStatus,
    terms_accepted_at: null,
    terms_version: null,
  });

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

  await deleteAppDataByUser(userId);
  await upsertSubscription(userId, {
    plan_tier: "free",
    plan_status: "active",
    plan_renewal_at: null,
    current_credits: DEFAULT_RESET_CREDITS,
    terms_accepted_at: null,
    terms_version: null,
    billing_provider_id: null,
    billing_metadata: {},
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

  const supabaseAuthUser = await getSupabaseAuthUser(userId);
  const metadataFirebaseUid =
    typeof supabaseAuthUser?.user_metadata === "object" && supabaseAuthUser.user_metadata
      ? (supabaseAuthUser.user_metadata as Record<string, unknown>).firebaseUid
      : null;
  const firebaseUid = typeof metadataFirebaseUid === "string" ? metadataFirebaseUid : null;

  if (firebaseUid) {
    try {
      await admin.auth().deleteUser(firebaseUid);
    } catch (error) {
      const code =
        typeof error === "object" && error && "code" in error
          ? String((error as {code?: unknown}).code)
          : "";
      if (code === "auth/user-not-found") {
        logger.info("Firebase auth user already deleted", {userId, firebaseUid});
      } else {
        logger.error("Failed to delete Firebase auth user", {
          userId,
          firebaseUid,
          error,
        });
        throw new HttpsError("internal", "Failed to delete Firebase auth user.");
      }
    }
  }

  await deleteAppDataByUser(userId);
  await deleteSubscriptionRows(userId);
  await deleteSupabaseAuthUser(userId);

  auditLog(adminContext.actorUid, adminContext.actorEmail, userId, "delete_user", requestId, {
    reason,
    firebaseUid,
  });

  return {
    success: true,
    action: "adminDeleteUser",
    targetUserId: userId,
    requestId,
    applied: {deleted: true},
  };
};

export {
  adminListUsersHandler,
  adminSetUserCreditsHandler,
  adminSetUserSubscriptionHandler,
  adminClearTermsAcceptanceHandler,
  adminResetUserStateHandler,
  adminDeleteUserHandler,
};

const sharedCallableOptions = {
  region: "us-central1" as const,
  enforceAppCheck: true,
  invoker: "public" as const,
  secrets: ["SUPABASE_SERVICE_ROLE_KEY"],
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
