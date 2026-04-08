import {CallableRequest, HttpsError} from "firebase-functions/v2/https";
import type {DecodedIdToken} from "firebase-admin/auth";

interface AdminContext {
  actorUid: string;
  actorEmail: string | null;
  token: DecodedIdToken;
}

function parseAllowList(envName: string, normalizeCase = false): Set<string> {
  const raw = process.env[envName] ?? "";
  return new Set(
    raw
      .split(",")
      .map((entry) => {
        const trimmed = entry.trim();
        return normalizeCase ? trimmed.toLowerCase() : trimmed;
      })
      .filter((entry) => entry.length > 0)
  );
}

// Env allowlists are read once per function instance; changing values requires a redeploy.
const ADMIN_ALLOWLIST_EMAILS = parseAllowList("ADMIN_ALLOWLIST_EMAILS", true);
const ADMIN_ALLOWLIST_UIDS = parseAllowList("ADMIN_ALLOWLIST_UIDS");

export function requireAdmin(request: CallableRequest): AdminContext {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const actorUid = request.auth.uid;
  const token = request.auth.token as DecodedIdToken | undefined;

  if (!token || token.uid !== actorUid) {
    throw new HttpsError("unauthenticated", "Invalid Firebase authentication token.");
  }

  const actorEmail = typeof token.email === "string" ? token.email.toLowerCase() : null;

  const claimIsAdmin = token.admin === true;
  const emailAllowed = actorEmail ? ADMIN_ALLOWLIST_EMAILS.has(actorEmail) : false;
  const uidAllowed = ADMIN_ALLOWLIST_UIDS.has(actorUid);

  if (!claimIsAdmin && !emailAllowed && !uidAllowed) {
    throw new HttpsError("permission-denied", "Admin access required.");
  }

  return {
    actorUid,
    actorEmail,
    token,
  };
}
