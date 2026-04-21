import {onCall, HttpsError, CallableRequest} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import admin from "firebase-admin";
import type {DecodedIdToken} from "firebase-admin/auth";
import { userRepository } from "./services/userRepository.js";
import { subscriptionService } from "./services/subscriptionService.js";
import { creditService } from "./services/creditService.js";
import { CLOUD_SQL_SECRETS } from "./cloudSqlSecrets.js";

const UNLIMITED_TIERS = new Set(["monthly_20", "monthly_50"]);
const DEFAULT_MODEL = "gemini-2.5-flash";
const DEFAULT_REGION = "us-central1";
const MAX_PROMPT_LENGTH = 12_000;
const MAX_REFERENCE_ID_LENGTH = 128;
const MAX_OUTPUT_TOKENS = 1_024;

// Initialize the Admin SDK if not already initialized
if (!admin.apps.length) {
  admin.initializeApp();
}

interface GenerateReplyData {
  prompt: string;
  referenceId?: string;
}

interface UsageState {
  planTier: string | null;
  planStatus: "active" | "cancelled" | "expired";
  hasUnlimited: boolean;
  creditBalance: number;
}

function normalizePlanStatus(status: string | null | undefined): UsageState["planStatus"] {
  if (status === "active" || status === "cancelled" || status === "expired") {
    return status;
  }

  return "expired";
}

export interface GenerateReplyResponse {
  reply: string;
  creditsSpent: number;
  remainingCredits: number | null;
  planTier: string | null;
  planStatus: "active" | "cancelled" | "expired";
  verifiedAt: string;
}

interface UsageSnapshotDetails {
  remainingCredits: number | null;
  planTier: string | null;
  planStatus: "active" | "cancelled" | "expired";
  verifiedAt: string;
}

type GenerateTextFn = (prompt: string) => Promise<string>;

interface GenerateReplyOptions {
  generateText?: GenerateTextFn;
}

interface CandidatePart {
  text?: string;
}

interface Candidate {
  content?: {
    parts?: CandidatePart[];
  };
}

interface GenerateContentResult {
  response: {
    candidates?: Candidate[];
  };
}

interface GenerativeModelLike {
  generateContent(prompt: string): Promise<GenerateContentResult>;
}

interface VertexAILike {
  getGenerativeModel(config: {
    model: string;
    generationConfig: {
      maxOutputTokens: number;
    };
  }): GenerativeModelLike;
}

interface VertexAIConstructor {
  new (config: {project: string; location: string}): VertexAILike;
}

interface VertexAIModule {
  VertexAI: VertexAIConstructor;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && typeof error.message === "string") {
    return error.message;
  }

  return String(error);
}

function isIdentityConflictError(error: unknown): boolean {
  return toErrorMessage(error).toLowerCase().includes("different firebase uid");
}

function getProjectId(): string | undefined {
  const fromEnv = process.env.GCLOUD_PROJECT ?? process.env.GCP_PROJECT;
  const value = fromEnv?.trim();
  return value ? value : undefined;
}

let textGenerator: GenerateTextFn | undefined;
let modelPromise: Promise<GenerativeModelLike> | undefined;

async function getModel(): Promise<GenerativeModelLike> {
  if (modelPromise) {
    return modelPromise;
  }

  const project = getProjectId();
  if (!project) {
    throw new HttpsError(
      "failed-precondition",
      "Missing GCLOUD_PROJECT for Vertex AI chat response generation."
    );
  }

  modelPromise = (async () => {
    try {
      // Avoid hard compile-time dependency resolution so typecheck still runs when
      // function deps are not installed in the current environment.
      const moduleName = "@google-cloud/vertexai";
      const vertexModule = await import(moduleName) as VertexAIModule;
      const vertex = new vertexModule.VertexAI({project, location: DEFAULT_REGION});

      return vertex.getGenerativeModel({
        model: DEFAULT_MODEL,
        generationConfig: {
          maxOutputTokens: MAX_OUTPUT_TOKENS,
        },
      });
    } catch (error: unknown) {
      modelPromise = undefined;

      const message = error instanceof Error ? error.message : String(error);
      const missingVertexModule =
        (error instanceof Error &&
          ("code" in error && error.code === "MODULE_NOT_FOUND")) ||
        message.includes("@google-cloud/vertexai");

      if (missingVertexModule) {
        throw new HttpsError(
          "failed-precondition",
          "The @google-cloud/vertexai package is not available. " +
            "Ensure it is installed and deployed with this function."
        );
      }

      if (error instanceof HttpsError) {
        throw error;
      }

      throw new HttpsError(
        "internal",
        `Failed to initialize Vertex AI model: ${message}`
      );
    }
  })();

  return modelPromise;
}

function getTextGenerator(): GenerateTextFn {
  if (textGenerator) {
    return textGenerator;
  }

  textGenerator = async (prompt: string): Promise<string> => {
    const model = await getModel();
    const result = await model.generateContent(prompt);
    const candidates = result.response.candidates ?? [];

    for (const candidate of candidates) {
      const parts = candidate.content?.parts ?? [];
      const text = parts
        .map((part: CandidatePart) => (typeof part.text === "string" ? part.text : ""))
        .join("")
        .trim();

      if (text.length > 0) {
        return text;
      }
    }

    throw new HttpsError("internal", "Vertex AI returned an empty response.");
  };

  return textGenerator;
}

function parseInput(data: unknown): {prompt: string; referenceId: string | null} {
  const payload = data as GenerateReplyData | undefined;
  const promptValue = payload?.prompt;
  const prompt = typeof promptValue === "string" ? promptValue.trim() : "";

  if (!prompt) {
    throw new HttpsError("invalid-argument", "prompt must be a non-empty string.");
  }

  if (prompt.length > MAX_PROMPT_LENGTH) {
    throw new HttpsError(
      "invalid-argument",
      `prompt must be at most ${MAX_PROMPT_LENGTH} characters.`
    );
  }

  const reference = typeof payload?.referenceId === "string" ? payload.referenceId.trim() : "";
  if (reference.length > MAX_REFERENCE_ID_LENGTH) {
    throw new HttpsError(
      "invalid-argument",
      `referenceId must be at most ${MAX_REFERENCE_ID_LENGTH} characters.`
    );
  }

  return {
    prompt,
    referenceId: reference.length > 0 ? reference : null,
  };
}

async function fetchUsageState(userId: string): Promise<UsageState> {
  const existing = await subscriptionService.getSubscription(userId);
  const sub = existing ?? await subscriptionService.getOrCreateDefaultSubscription(userId);

  const planTier = sub.planTier;
  const planStatus = normalizePlanStatus(sub.planStatus);
  const isActive = planStatus === "active";
  const hasUnlimited = isActive && UNLIMITED_TIERS.has(planTier);
  const creditBalance = hasUnlimited ? 0 : Math.max(0, sub.currentCredits ?? 0);

  return {
    planTier,
    planStatus,
    hasUnlimited,
    creditBalance,
  };
}

function toUsageSnapshotDetails(usage: UsageState): UsageSnapshotDetails {
  return {
    remainingCredits: usage.hasUnlimited ? null : usage.creditBalance,
    planTier: usage.planTier,
    planStatus: usage.planStatus,
    verifiedAt: new Date().toISOString(),
  };
}

function assertUsageAuthorized(usage: UsageState): void {
  if (!usage.hasUnlimited && usage.creditBalance < 1) {
    throw new HttpsError(
      "resource-exhausted",
      "Insufficient credits. Purchase credits or subscribe for unlimited access.",
      toUsageSnapshotDetails(usage)
    );
  }
}

async function spendOneCreditIfRequired(
  userId: string,
  usage: UsageState,
  referenceId: string | null
): Promise<number | null> {
  if (usage.hasUnlimited) {
    return null;
  }

  try {
    const success = await creditService.spendCredits(userId, 1, "chat response", referenceId ?? undefined);
    if (!success) {
      throw new HttpsError("resource-exhausted", "Insufficient credits to complete the operation.");
    }
    
    // Get updated credits
    return await creditService.getCredits(userId);
  } catch (error) {
    if (error instanceof HttpsError) {
      throw error;
    }

    logger.error("Failed to spend user credits", {
      userId,
      referenceId,
      error,
    });

    throw new HttpsError("internal", "Failed to spend user credits.");
  }
}

const handler = async (
  request: CallableRequest,
  options: GenerateReplyOptions = {}
): Promise<GenerateReplyResponse> => {
  if (!request.auth) {
    logger.error("Unauthenticated request to generateReply");
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

  const {prompt, referenceId} = parseInput(request.data);

  let user: Awaited<ReturnType<typeof userRepository.getOrCreateUserByFirebaseIdentity>>;
  try {
    user = await userRepository.getOrCreateUserByFirebaseIdentity({
      firebaseUid: request.auth.uid,
      email,
      displayName: decoded.name || null,
      avatarUrl: decoded.picture || null,
    });
  } catch (error: unknown) {
    logger.error("Failed to bootstrap user identity in generateReply", {
      firebaseUid: request.auth.uid,
      email,
      error,
    });

    if (isIdentityConflictError(error)) {
      throw new HttpsError(
        "failed-precondition",
        "User identity is already linked to another account."
      );
    }

    throw new HttpsError("internal", "Failed to bootstrap user.");
  }

  const usage = await fetchUsageState(user.id);
  assertUsageAuthorized(usage);

  const generateText = options.generateText ?? getTextGenerator();

  let reply: string;
  try {
    reply = (await generateText(prompt)).trim();
  } catch (error) {
    logger.error("generateReply model call failed", {
      userId: user.id,
      error,
    });

    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError("internal", "Failed to generate chat response.");
  }

  if (!reply) {
    throw new HttpsError("internal", "Model returned an empty chat response.");
  }

  const remainingCredits = await spendOneCreditIfRequired(user.id, usage, referenceId);

  return {
    reply,
    creditsSpent: usage.hasUnlimited ? 0 : 1,
    remainingCredits,
    planTier: usage.planTier,
    planStatus: usage.planStatus,
    verifiedAt: new Date().toISOString(),
  };
};

export const generateReplyHandler = handler;

export const generateReply = onCall(
  {
    region: DEFAULT_REGION,
    enforceAppCheck: true,
    invoker: "public",
    secrets: [...CLOUD_SQL_SECRETS],
  },
  (request) => handler(request)
);
