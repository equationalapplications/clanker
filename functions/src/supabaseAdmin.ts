import {HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import {createClient, SupabaseClient} from "@supabase/supabase-js";
import {getSupabaseUrl} from "./runtimeConfig.js";

function getSupabaseServiceRoleKey(): string | undefined {
  return process.env.SUPABASE_SERVICE_ROLE_KEY;
}

/**
 * Return a Supabase admin client configured with the service role key.
 * Throws HttpsError if credentials are missing.
 */
export function getSupabaseAdminClient(): SupabaseClient {
  const supabaseUrl = getSupabaseUrl();
  const supabaseServiceRoleKey = getSupabaseServiceRoleKey();
  if (!supabaseServiceRoleKey || !supabaseUrl) {
    throw new HttpsError(
      "failed-precondition",
      "Missing SUPABASE_SERVICE_ROLE_KEY or SUPABASE_URL."
    );
  }

  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {autoRefreshToken: false, persistSession: false},
  });
}

/**
 * Find a Supabase user by email via the get_user_id_by_email RPC function.
 * Returns { id } if found, otherwise null.
 */
export async function findSupabaseUserByEmail(
  email: string
): Promise<{id: string} | null> {
  try {
    const supabase = getSupabaseAdminClient();
    const {data, error} = await supabase.rpc("get_user_id_by_email", {
      lookup_email: email.toLowerCase(),
    });

    if (error) {
      throw error;
    }

    if (typeof data === "string" && data.length > 0) {
      return {id: data};
    }
    return null;
  } catch (error) {
    if (error instanceof HttpsError) {
      throw error;
    }
    logger.error("Error finding Supabase user", {error, email});
    throw new HttpsError("internal", "Failed to look up user by email.");
  }
}

/**
 * Find a Supabase auth user by email, including soft-deleted users.
 * Uses the get_auth_user_by_email RPC (queries auth.users directly).
 * Returns { id, deletedAt } if found, otherwise null.
 */
export async function findSupabaseUserByEmailIncludeDeleted(
  email: string
): Promise<{id: string; deletedAt: string | null} | null> {
  try {
    const body = await callSupabaseRpc("get_auth_user_by_email", {
      lookup_email: email.toLowerCase(),
    });

    if (body && typeof body === "object" && !Array.isArray(body)) {
      const record = body as Record<string, unknown>;
      const id = record["user_id"];
      if (typeof id === "string" && id.length > 0) {
        const deletedAt = typeof record["deleted_at"] === "string" ? record["deleted_at"] : null;
        return {id, deletedAt};
      }
    }
    return null;
  } catch (error) {
    if (error instanceof HttpsError) {
      throw error;
    }
    logger.error("Error finding Supabase auth user (include deleted)", {error, email});
    throw new HttpsError("internal", "Failed to look up user by email.");
  }
}

/**
 * Call a Supabase RPC function using the service role key.
 */
export async function callSupabaseRpc(
  fnName: string,
  params: Record<string, unknown>
): Promise<unknown> {
  const supabaseUrl = getSupabaseUrl();
  const supabaseServiceRoleKey = getSupabaseServiceRoleKey();
  if (!supabaseServiceRoleKey || !supabaseUrl) {
    throw new HttpsError(
      "failed-precondition",
      "Missing SUPABASE_SERVICE_ROLE_KEY or SUPABASE_URL."
    );
  }

  const base = supabaseUrl.replace(/\/+$/, "");
  const url = `${base}/rest/v1/rpc/${fnName}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${supabaseServiceRoleKey}`,
      "apikey": supabaseServiceRoleKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const errorText = await res.text();
    const correlationId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    logger.error(`Supabase RPC ${fnName} failed`, {
      correlationId,
      status: res.status,
      statusText: res.statusText,
      error: errorText,
    });
    throw new HttpsError(
      "internal",
      `Supabase RPC failed. Reference: ${correlationId}`
    );
  }

  return res.json();
}

/**
 * Find a Supabase user by their Firebase UID stored in user_metadata.
 * Uses the get_user_id_by_firebase_uid RPC function (requires service_role).
 * Returns { id } if found, otherwise null.
 */
export async function findSupabaseUserByFirebaseUid(
  firebaseUid: string
): Promise<{id: string} | null> {
  try {
    const body = await callSupabaseRpc("get_user_id_by_firebase_uid", {
      lookup_firebase_uid: firebaseUid,
    });

    if (typeof body === "string" && body.length > 0) {
      return {id: body};
    }
    return null;
  } catch (error) {
    if (error instanceof HttpsError) {
      throw error;
    }
    logger.error("Error finding Supabase user by firebase UID", {error, firebaseUid});
    throw new HttpsError("internal", "Failed to look up user by Firebase UID.");
  }
}

/**
 * Upsert a user_app_subscriptions row using the service role REST API.
 */
export async function upsertUserSubscription(
  supabaseUserId: string,
  appName: string,
  planTier: string,
  planStatus: string,
  extraFields: Record<string, unknown> = {}
): Promise<void> {
  const supabaseUrl = getSupabaseUrl();
  const supabaseServiceRoleKey = getSupabaseServiceRoleKey();
  if (!supabaseServiceRoleKey || !supabaseUrl) {
    throw new HttpsError(
      "failed-precondition",
      "Missing SUPABASE_SERVICE_ROLE_KEY or SUPABASE_URL."
    );
  }

  const base = supabaseUrl.replace(/\/+$/, "");
  const url = `${base}/rest/v1/user_app_subscriptions?on_conflict=user_id,app_name`;

  const body = {
    user_id: supabaseUserId,
    app_name: appName,
    plan_tier: planTier,
    plan_status: planStatus,
    updated_at: new Date().toISOString(),
    ...extraFields,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${supabaseServiceRoleKey}`,
      "apikey": supabaseServiceRoleKey,
      "Content-Type": "application/json",
      // Upsert on (user_id, app_name) conflict — merge all provided columns
      "Prefer": "resolution=merge-duplicates",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorText = await res.text();
    const errorReference =
      `supabase-upsert-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    logger.error("Failed to upsert user subscription", {
      errorReference,
      status: res.status,
      statusText: res.statusText,
      error: errorText,
    });
    throw new HttpsError(
      "internal",
      `Failed to upsert subscription. Reference: ${errorReference}`
    );
  }
}
