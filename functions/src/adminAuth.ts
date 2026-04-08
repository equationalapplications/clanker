import {CallableRequest, HttpsError} from "firebase-functions/v2/https";
import type {DecodedIdToken} from "firebase-admin/auth";

interface AdminContext {
  actorUid: string;
  actorEmail: string | null;
  token: DecodedIdToken;
}

function parseAllowList(envName: string): Set<string> {
  const raw = process.env[envName] ?? "";
  return new Set(
    raw
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.length > 0)
  );
}

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
  const emailAllowList = parseAllowList("ADMIN_ALLOWLIST_EMAILS");
  const uidAllowList = parseAllowList("ADMIN_ALLOWLIST_UIDS");
  const emailAllowed = actorEmail ? emailAllowList.has(actorEmail) : false;
  const uidAllowed = uidAllowList.has(actorUid.toLowerCase());

  if (!claimIsAdmin && !emailAllowed && !uidAllowed) {
    throw new HttpsError("permission-denied", "Admin access required.");
  }

  return {
    actorUid,
    actorEmail,
    token,
  };
}
