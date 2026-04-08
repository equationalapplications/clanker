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
const ALLOWED_PLAN_TIERS = new Set(["free", "monthly_20", "monthly_50", "payg"]);
const ALLOWED_PLAN_STATUS = new Set(["active", "canceled", "past_due", "paused", "trialing"]);

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
    throw new HttpsError("invalid-argument", "requestId must be a non-empty string.");
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
    return null;
  }

  const rows = await parseJsonSafe<Array<Record<string, unknown>>>(response);
  return rows && rows.length > 0 ? rows[0] : null;
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

async function deleteAppDataByUser(userId: string): Promise<void> {
  const deleteMessages = await supabaseRequest(
    `/rest/v1/clanker_messages?or=(sender_user_id.eq.${encodeURIComponent(userId)},recipient_user_id.eq.${encodeURIComponent(userId)})`,
    {method: "DELETE"}
  );

  if (!deleteMessages.ok) {
    const errorText = await deleteMessages.text();
    logger.error("Failed to delete user messages", {userId, errorText});
    throw new HttpsError("internal", "Failed to delete user messages.");
  }

  const deleteCharacters = await supabaseRequest(
    `/rest/v1/clanker_characters?user_id=eq.${encodeURIComponent(userId)}`,
    {method: "DELETE"}
  );

  if (!deleteCharacters.ok) {
    const errorText = await deleteCharacters.text();
    logger.error("Failed to delete user characters", {userId, errorText});
    throw new HttpsError("internal", "Failed to delete user characters.");
  }
}

async function deleteSubscriptionRows(userId: string): Promise<void> {
  const deleteResponse = await supabaseRequest(
    `/rest/v1/user_app_subscriptions?user_id=eq.${encodeURIComponent(userId)}`,
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
    const errorText = await response.text();
    logger.error("Failed to delete Supabase auth user", {userId, errorText});
    throw new HttpsError("internal", "Failed to delete Supabase auth user.");
  }
}

async function getSupabaseAuthUser(userId: string): Promise<Record<string, unknown> | null> {
  const response = await supabaseRequest(`/auth/v1/admin/users/${encodeURIComponent(userId)}`);

  if (!response.ok) {
    const errorText = await response.text();
    logger.error("Failed to fetch Supabase auth user", {userId, errorText});
    return null;
  }

  return parseJsonSafe<Record<string, unknown>>(response);
}

async function getSupabaseAuthUsers(page: number, pageSize: number): Promise<Array<Record<string, unknown>>> {
  const response = await supabaseRequest(
    `/auth/v1/admin/users?page=${page}&per_page=${pageSize}`
  );

  if (!response.ok) {
    const errorText = await response.text();
    logger.error("Failed to list users from Supabase auth admin", {errorText});
    throw new HttpsError("internal", "Failed to list users.");
  }

  const payload = await parseJsonSafe<{users?: Array<Record<string, unknown>>}>(response);
  return payload?.users ?? [];
}

const adminListUsersHandler = async (request: CallableRequest) => {
  const adminContext = requireAdmin(request);
  const data = (request.data ?? {}) as AdminListUsersData;

  const page = Number.isFinite(data.page) ? Math.max(1, Math.floor(data.page ?? 1)) : 1;
  const pageSize = Number.isFinite(data.pageSize)
    ? Math.min(100, Math.max(1, Math.floor(data.pageSize ?? 25)))
    : 25;
  const search = typeof data.search === "string" ? data.search.trim().toLowerCase() : "";

  const users = await getSupabaseAuthUsers(page, pageSize);

  const hydratedUsers = await Promise.all(
    users.map(async (user) => {
      const userId = typeof user.id === "string" ? user.id : "";
      const subscription = userId ? await getSubscriptionRow(userId) : null;
      const email =
        typeof user.email === "string"
          ? user.email
          : typeof user.phone === "string"
            ? user.phone
            : "unknown";

      return {
        userId,
        email,
        createdAt: user.created_at ?? null,
        planTier: (subscription?.plan_tier as string | null) ?? "free",
        planStatus: (subscription?.plan_status as string | null) ?? "active",
        currentCredits: Number(subscription?.current_credits ?? 0),
        termsAcceptedAt: (subscription?.terms_accepted_at as string | null) ?? null,
        termsVersion: (subscription?.terms_version as string | null) ?? null,
      };
    })
  );

  const filtered = hydratedUsers.filter((row) => {
    if (!row.userId) {
      return false;
    }

    if (search.length > 0) {
      const matchSearch =
        row.email.toLowerCase().includes(search) || row.userId.toLowerCase().includes(search);
      if (!matchSearch) {
        return false;
      }
    }

    if (data.planTier && row.planTier !== data.planTier) {
      return false;
    }

    if (data.planStatus && row.planStatus !== data.planStatus) {
      return false;
    }

    return true;
  });

  logger.info("admin_list_users", {
    actorUid: adminContext.actorUid,
    actorEmail: adminContext.actorEmail,
    page,
    pageSize,
    resultCount: filtered.length,
  });

  return {
    success: true,
    users: filtered,
    page,
    pageSize,
    hasMore: hydratedUsers.length === pageSize,
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

  const credits = Math.floor(data.credits);
  const existingSubscription = await getSubscriptionRow(userId);
  const planTier = (existingSubscription?.plan_tier as string | null) ?? "free";
  const planStatus = (existingSubscription?.plan_status as string | null) ?? "active";

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

  const renewalDate =
    typeof data.renewalDate === "string" && data.renewalDate.trim().length > 0
      ? data.renewalDate
      : null;

  await upsertSubscription(userId, {
    plan_tier: planTier,
    plan_status: planStatus,
    billing_cycle_end: renewalDate,
  });

  auditLog(
    adminContext.actorUid,
    adminContext.actorEmail,
    userId,
    "set_subscription",
    requestId,
    {
      planTier,
      planStatus,
      renewalDate,
      reason,
    }
  );

  return {
    success: true,
    action: "adminSetUserSubscription",
    targetUserId: userId,
    requestId,
    applied: {planTier, planStatus, renewalDate},
  };
};

const adminClearTermsAcceptanceHandler = async (request: CallableRequest) => {
  const adminContext = requireAdmin(request);
  const data = (request.data ?? {}) as AdminMutationData;

  const userId = assertUserId(data.userId);
  const reason = assertReason(data.reason);
  const requestId = assertRequestId(data.requestId);

  await upsertSubscription(userId, {
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
    current_credits: DEFAULT_RESET_CREDITS,
    terms_accepted_at: null,
    terms_version: null,
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

  await deleteAppDataByUser(userId);
  await deleteSubscriptionRows(userId);
  await deleteSupabaseAuthUser(userId);

  if (firebaseUid) {
    try {
      await admin.auth().deleteUser(firebaseUid);
    } catch (error) {
      logger.error("Failed to delete Firebase auth user", {
        userId,
        firebaseUid,
        error,
      });
      throw new HttpsError("internal", "Failed to delete Firebase auth user.");
    }
  }

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
  secrets: ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_URL"],
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
