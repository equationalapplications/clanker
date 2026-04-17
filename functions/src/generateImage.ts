import {onCall, HttpsError, CallableRequest} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import admin from "firebase-admin";
import type {DecodedIdToken} from "firebase-admin/auth";
import {
  callSupabaseRpc,
  findSupabaseUserByFirebaseUid,
  findSupabaseUserByEmail,
  getSupabaseAdminClient,
} from "./supabaseAdmin.js";
import {extractRemainingCredits, isAcknowledgedSpend} from "./billing.js";

const APP_NAME = "clanker";
const UNLIMITED_TIERS = new Set(["monthly_20", "monthly_50"]);
const DEFAULT_MODEL = "gemini-2.5-flash-image";
const DEFAULT_REGION = "us-central1";
const MAX_PROMPT_LENGTH = 2_000;
const MAX_REFERENCE_ID_LENGTH = 128;
const MAX_BASE64_LENGTH = 8_000_000;
const THROTTLE_WINDOW_MS = 60_000;
const THROTTLE_MAX_REQUESTS = 5;
const ALLOWED_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

if (!admin.apps.length) {
  admin.initializeApp();
}

interface GenerateImageData {
  prompt: string;
  referenceId?: string;
}

interface SubscriptionRow {
  plan_tier: string;
  current_credits: number | null;
}

interface UsageState {
  planTier: string | null;
  hasUnlimited: boolean;
  creditBalance: number;
}

interface GeneratedImageResult {
  imageBase64: string;
  mimeType: string;
}

export interface GenerateImageResponse {
  imageBase64: string;
  mimeType: string;
  creditsSpent: number;
  remainingCredits: number | null;
  planTier: string | null;
}

type GenerateImageFn = (prompt: string) => Promise<GeneratedImageResult>;

interface GenerateImageOptions {
  generateImage?: GenerateImageFn;
}

interface CandidateInlineData {
  data?: string;
  mimeType?: string;
}

interface CandidatePart {
  inlineData?: CandidateInlineData;
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
      responseModalities: string[];
    };
  }): GenerativeModelLike;
}

interface VertexAIConstructor {
  new (config: {project: string; location: string}): VertexAILike;
}

interface VertexAIModule {
  VertexAI: VertexAIConstructor;
}

function getProjectId(): string | undefined {
  const fromEnv = process.env.GCLOUD_PROJECT ?? process.env.GCP_PROJECT;
  const value = fromEnv?.trim();
  return value ? value : undefined;
}

function parseInput(data: unknown): {prompt: string; referenceId: string | null} {
  const payload = data as GenerateImageData | undefined;
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

function parseUsage(rows: SubscriptionRow[]): UsageState {
  if (rows.length === 0) {
    return {
      planTier: null,
      hasUnlimited: false,
      creditBalance: 0,
    };
  }

  let hasUnlimited = false;
  let credits = 0;
  let planTier: string | null = null;

  for (const row of rows) {
    if (!planTier) {
      planTier = row.plan_tier;
    }

    if (UNLIMITED_TIERS.has(row.plan_tier)) {
      hasUnlimited = true;
      planTier = row.plan_tier;
      continue;
    }

    credits += Math.max(0, row.current_credits ?? 0);
  }

  return {
    planTier,
    hasUnlimited,
    creditBalance: credits,
  };
}

async function fetchUsageState(supabaseUserId: string): Promise<UsageState> {
  const supabase = getSupabaseAdminClient();
  const {data, error} = await supabase
    .from("user_app_subscriptions")
    .select("plan_tier, current_credits")
    .eq("user_id", supabaseUserId)
    .eq("app_name", APP_NAME)
    .eq("plan_status", "active");

  if (error) {
    logger.error("Failed to load subscription state for generateImage", {
      supabaseUserId,
      error,
    });
    throw new HttpsError("internal", "Failed to verify subscription access.");
  }

  return parseUsage((data ?? []) as SubscriptionRow[]);
}

function assertUsageAuthorized(usage: UsageState): void {
  if (!usage.hasUnlimited && usage.creditBalance < 1) {
    throw new HttpsError(
      "resource-exhausted",
      "Insufficient credits. Purchase credits or subscribe for unlimited access."
    );
  }
}

async function spendOneCredit(
  supabaseUserId: string,
  referenceId: string | null
): Promise<number | null> {
  const spendResult = await callSupabaseRpc("spend_user_credits", {
    p_user_id: supabaseUserId,
    p_app_name: APP_NAME,
    p_credit_amount: 1,
    p_description: "image generation",
    p_reference_id: referenceId,
  });

  const remainingCredits = extractRemainingCredits(spendResult);
  if (remainingCredits !== null) {
    return remainingCredits;
  }

  if (isAcknowledgedSpend(spendResult)) {
    return null;
  }

  logger.error("spend_user_credits returned invalid payload for generateImage", {
    supabaseUserId,
    spendResult,
  });
  throw new HttpsError("internal", "Failed to spend user credits.");
}

async function spendOneCreditIfRequired(
  supabaseUserId: string,
  usage: UsageState,
  referenceId: string | null
): Promise<number | null> {
  if (usage.hasUnlimited) {
    return null;
  }

  return spendOneCredit(supabaseUserId, referenceId);
}

function assertSupportedImageMimeType(mimeType: string): string {
  const normalized = mimeType.trim().toLowerCase();
  if (!ALLOWED_IMAGE_MIME_TYPES.has(normalized)) {
    throw new HttpsError("internal", "Model returned an unsupported image format.");
  }

  return normalized;
}

let modelPromise: Promise<GenerativeModelLike> | undefined;
let imageGenerator: GenerateImageFn | undefined;

async function getModel(): Promise<GenerativeModelLike> {
  if (modelPromise) {
    return modelPromise;
  }

  const project = getProjectId();
  if (!project) {
    throw new HttpsError(
      "failed-precondition",
      "Missing GCLOUD_PROJECT for Vertex AI image generation."
    );
  }

  modelPromise = (async () => {
    try {
      const moduleName = "@google-cloud/vertexai";
      const vertexModule = await import(moduleName) as VertexAIModule;
      const vertex = new vertexModule.VertexAI({project, location: DEFAULT_REGION});

      return vertex.getGenerativeModel({
        model: DEFAULT_MODEL,
        generationConfig: {
          responseModalities: ["TEXT", "IMAGE"],
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

      throw new HttpsError("internal", `Failed to initialize image model: ${message}`);
    }
  })();

  return modelPromise;
}

function buildImagePrompt(userPrompt: string): string {
  const compact = userPrompt.replace(/\s+/g, " ").trim();
  return [
    "Create a polished square character avatar portrait.",
    "Focus on head and shoulders.",
    "Use a clean, simple background.",
    "Return a single image output.",
    `User request: ${compact}`,
  ].join(" ");
}

function getImageGenerator(): GenerateImageFn {
  if (imageGenerator) {
    return imageGenerator;
  }

  imageGenerator = async (prompt: string): Promise<GeneratedImageResult> => {
    const model = await getModel();
    const result = await model.generateContent(buildImagePrompt(prompt));
    const candidates = result.response.candidates ?? [];

    for (const candidate of candidates) {
      const parts = candidate.content?.parts ?? [];
      for (const part of parts) {
        const data = part.inlineData?.data?.trim();
        if (data) {
          return {
            imageBase64: data,
            mimeType: part.inlineData?.mimeType ?? "image/png",
          };
        }
      }
    }

    throw new HttpsError("internal", "Vertex AI returned no image data.");
  };

  return imageGenerator;
}

// Per-user request throttle for image generation.
// Note: This is instance-level memory and does not enforce limits across multiple Cloud Run instances.
// For global rate limiting across instances, consider using Firestore/Supabase.
const throttleBuckets = new Map<string, number[]>();
const THROTTLE_CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// Periodic cleanup of expired throttle entries to prevent unbounded memory growth
function startThrottleCleanupTimer(): void {
  const timer = setInterval(() => {
    const now = Date.now();
    let cleaned = 0;

    for (const [firebaseUid, timestamps] of throttleBuckets.entries()) {
      const recent = timestamps.filter(
        (timestamp) => now - timestamp < THROTTLE_WINDOW_MS
      );

      if (recent.length === 0) {
        throttleBuckets.delete(firebaseUid);
        cleaned++;
      } else if (recent.length !== timestamps.length) {
        throttleBuckets.set(firebaseUid, recent);
      }
    }

    if (cleaned > 0) {
      logger.debug(`Throttle cleanup: removed ${cleaned} expired user buckets`, {
        bucketsRemaining: throttleBuckets.size,
      });
    }
  }, THROTTLE_CLEANUP_INTERVAL_MS);

  // Don't block process exit for this background timer
  timer.unref();
}

// Start cleanup timer on module load
startThrottleCleanupTimer();

function assertWithinRateLimit(firebaseUid: string): void {
  const now = Date.now();
  const timestamps = throttleBuckets.get(firebaseUid) ?? [];
  const recent = timestamps.filter(
    (timestamp) => now - timestamp < THROTTLE_WINDOW_MS
  );

  if (recent.length === 0) {
    throttleBuckets.delete(firebaseUid);
  }

  if (recent.length >= THROTTLE_MAX_REQUESTS) {
    throw new HttpsError(
      "resource-exhausted",
      "Too many image generation requests. Please wait and retry."
    );
  }

  recent.push(now);
  throttleBuckets.set(firebaseUid, recent);
}

const handler = async (
  request: CallableRequest,
  options: GenerateImageOptions = {}
): Promise<GenerateImageResponse> => {
  const start = Date.now();

  if (!request.auth) {
    logger.error("Unauthenticated request to generateImage");
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

  let supabaseUser = await findSupabaseUserByFirebaseUid(request.auth.uid);
  if (!supabaseUser) {
    logger.info("No Supabase user found for Firebase UID; falling back to email lookup", {
      firebaseUid: request.auth.uid,
    });
    supabaseUser = await findSupabaseUserByEmail(email);
  }

  if (!supabaseUser) {
    logger.info("No Supabase user found for authenticated Firebase identity", {
      email,
      firebaseUid: request.auth.uid,
    });
    throw new HttpsError("not-found", "User not found.");
  }

  const usage = await fetchUsageState(supabaseUser.id);
  assertUsageAuthorized(usage);
  assertWithinRateLimit(request.auth.uid);

  const generateImage = options.generateImage ?? getImageGenerator();

  let imageResult: GeneratedImageResult;
  try {
    imageResult = await generateImage(prompt);
  } catch (error) {
    logger.error("generateImage model call failed", {
      supabaseUserId: supabaseUser.id,
      error,
    });

    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError("internal", "Failed to generate image.");
  }

  if (!imageResult.imageBase64) {
    throw new HttpsError("internal", "Model returned an empty image payload.");
  }

  if (imageResult.imageBase64.length > MAX_BASE64_LENGTH) {
    throw new HttpsError(
      "resource-exhausted",
      "Generated image payload too large. Please try a simpler prompt."
    );
  }

  const normalizedMimeType = assertSupportedImageMimeType(imageResult.mimeType);

  let remainingCredits: number | null;
  try {
    remainingCredits = await spendOneCreditIfRequired(supabaseUser.id, usage, referenceId);
  } catch (error) {
    logger.error("spendOneCreditIfRequired failed", {
      firebaseUid: request.auth.uid,
      supabaseUserId: supabaseUser.id,
      error,
    });

    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError("internal", "Failed to spend user credits.");
  }

  const latencyMs = Date.now() - start;

  logger.info("generateImage succeeded", {
    firebaseUid: request.auth.uid,
    supabaseUserId: supabaseUser.id,
    planTier: usage.planTier,
    creditsSpent: usage.hasUnlimited ? 0 : 1,
    remainingCredits,
    latencyMs,
    imageBytesApprox: Math.floor(imageResult.imageBase64.length * 0.75),
  });

  return {
    imageBase64: imageResult.imageBase64,
    mimeType: normalizedMimeType,
    creditsSpent: usage.hasUnlimited ? 0 : 1,
    remainingCredits,
    planTier: usage.planTier,
  };
};

export const generateImageHandler = handler;

export const generateImage = onCall(
  {
    region: DEFAULT_REGION,
    enforceAppCheck: true,
    invoker: "public",
    secrets: ["SUPABASE_SERVICE_ROLE_KEY"],
  },
  (request) => handler(request)
);
