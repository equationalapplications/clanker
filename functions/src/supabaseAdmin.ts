import {HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";

const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;

/**
 * Find a Supabase user by email via the get_user_id_by_email RPC function.
 * Returns { id } if found, otherwise null.
 */
export async function findSupabaseUserByEmail(
  email: string
): Promise<{id: string} | null> {
  if (!SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_URL) {
    logger.warn("Missing Supabase service role key or URL for user lookup");
    return null;
  }

  const base = SUPABASE_URL.replace(/\/+$/, "");
  const url = `${base}/rest/v1/rpc/get_user_id_by_email`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({lookup_email: email.toLowerCase()}),
    });

    if (!res.ok) {
      logger.error("Failed to look up Supabase user by email", {
        status: res.status,
        statusText: res.statusText,
        email,
      });
      return null;
    }

    const body: unknown = await res.json();

    if (typeof body === "string" && body.length > 0) {
      return {id: body};
    }
    return null;
  } catch (error) {
    logger.error("Error finding Supabase user", {error, email});
    return null;
  }
}

/**
 * Call a Supabase RPC function using the service role key.
 */
export async function callSupabaseRpc(
  fnName: string,
  params: Record<string, unknown>
): Promise<unknown> {
  if (!SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_URL) {
    throw new HttpsError(
      "failed-precondition",
      "Missing SUPABASE_SERVICE_ROLE_KEY or SUPABASE_URL."
    );
  }

  const base = SUPABASE_URL.replace(/\/+$/, "");
  const url = `${base}/rest/v1/rpc/${fnName}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "apikey": SUPABASE_SERVICE_ROLE_KEY,
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
  if (!SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_URL) {
    logger.warn("Missing Supabase service role key or URL for firebase UID lookup");
    return null;
  }

  const base = SUPABASE_URL.replace(/\/+$/, "");
  const url = `${base}/rest/v1/rpc/get_user_id_by_firebase_uid`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({lookup_firebase_uid: firebaseUid}),
    });

    if (!res.ok) {
      logger.error("Failed to look up Supabase user by firebase UID", {
        status: res.status,
        statusText: res.statusText,
        firebaseUid,
      });
      return null;
    }

    const body: unknown = await res.json();

    if (typeof body === "string" && body.length > 0) {
      return {id: body};
    }
    return null;
  } catch (error) {
    logger.error("Error finding Supabase user by firebase UID", {error, firebaseUid});
    return null;
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
  if (!SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_URL) {
    throw new HttpsError(
      "failed-precondition",
      "Missing SUPABASE_SERVICE_ROLE_KEY or SUPABASE_URL."
    );
  }

  const base = SUPABASE_URL.replace(/\/+$/, "");
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
      "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "apikey": SUPABASE_SERVICE_ROLE_KEY,
      "Content-Type": "application/json",
      // Upsert on (user_id, app_name) conflict — merge all provided columns
      "Prefer": "resolution=merge-duplicates",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorText = await res.text();
    logger.error("Failed to upsert user subscription", {
      status: res.status,
      statusText: res.statusText,
      error: errorText,
    });
    throw new HttpsError("internal", `Failed to upsert subscription: ${errorText}`);
  }
}
