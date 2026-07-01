import {onCall, HttpsError, CallableRequest} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import admin from "firebase-admin";
import type {DecodedIdToken} from "firebase-admin/auth";
import { GoogleGenAI } from "@google/genai";
import { userRepository } from "./services/userRepository.js";
import { subscriptionService } from "./services/subscriptionService.js";
import { creditService, type CreditSpendAllocation } from "./services/creditService.js";
import { buildUsageSnapshotForUser } from "./usageSnapshot.js";
import { CLOUD_SQL_SECRETS } from "./cloudSqlSecrets.js";

const DEFAULT_MODEL = "gemini-2.5-flash-image";
const DEFAULT_REGION = "us-central1";
const MAX_PROMPT_LENGTH = 2_000;
const MAX_BASE64_LENGTH = 8_000_000;
const THROTTLE_WINDOW_MS = 60_000;
const THROTTLE_MAX_REQUESTS = 5;
const ALLOWED_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

if (!admin.apps.length) {
  admin.initializeApp();
}

interface GenerateImageData {
  prompt: string;
}

interface GeneratedImageResult {
  imageBase64: string;
  mimeType: string;
}

export interface GenerateImageResponse {
  imageBase64: string;
  mimeType: string;
  creditsSpent: number;
  remainingCredits: number;
  planTier: string | null;
  planStatus: 'active' | 'cancelled' | 'expired' | null;
  verifiedAt: string;
}

type GenerateImageFn = (prompt: string) => Promise<GeneratedImageResult>;

interface GenerateImageOptions {
  generateImage?: GenerateImageFn;
  creditService?: Pick<typeof creditService, 'spendCredits' | 'refundCredit' | 'getCredits'>;
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

function isVertexIamPermissionDenied(error: unknown): boolean {
  const message = toErrorMessage(error).toLowerCase();
  if (
    message.includes("iam_permission_denied") ||
    message.includes("aiplatform.endpoints.predict")
  ) {
    return true;
  }

  if (!error || typeof error !== "object") {
    return false;
  }

  const raw = error as {
    code?: number;
    status?: string;
    details?: Array<{reason?: string; metadata?: {permission?: string}}>;
    stackTrace?: {
      code?: number;
      status?: string;
      errorDetails?: Array<{reason?: string; metadata?: {permission?: string}}>;
    };
  };

  const code = raw.stackTrace?.code ?? raw.code;
  const status = (raw.stackTrace?.status ?? raw.status ?? "").toString().toUpperCase();
  const details = [...(raw.stackTrace?.errorDetails ?? []), ...(raw.details ?? [])];
  const detailSignals = details.some((detail) => {
    const reason = (detail.reason ?? "").toUpperCase();
    const permission = detail.metadata?.permission ?? "";
    return reason === "IAM_PERMISSION_DENIED" || permission === "aiplatform.endpoints.predict";
  });

  return (code === 403 || status === "PERMISSION_DENIED") && detailSignals;
}

function getProjectId(): string | undefined {
  const fromEnv = process.env.GCLOUD_PROJECT ?? process.env.GCP_PROJECT;
  const value = fromEnv?.trim();
  return value ? value : undefined;
}

function parseInput(data: unknown): {prompt: string} {
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

  return { prompt };
}

async function chargeForImage(
  userId: string,
  credits: Pick<typeof creditService, 'spendCredits' | 'refundCredit' | 'getCredits'>
): Promise<{ spendAllocations: CreditSpendAllocation[]; remainingCredits: number }> {
  const spendAllocations = await credits.spendCredits(userId, 1);
  if (spendAllocations === null) {
    throw new HttpsError("failed-precondition", "Insufficient credits.");
  }

  const remainingCredits = await credits.getCredits(userId);
  return { spendAllocations, remainingCredits };
}


function assertSupportedImageMimeType(mimeType: string): string {
  const normalized = mimeType.trim().toLowerCase();
  if (!ALLOWED_IMAGE_MIME_TYPES.has(normalized)) {
    throw new HttpsError("internal", "Model returned an unsupported image format.");
  }

  return normalized;
}

let genAIClient: GoogleGenAI | undefined;
let imageGenerator: GenerateImageFn | undefined;

function getGenAIClient(): GoogleGenAI {
  if (genAIClient) {
    return genAIClient;
  }

  const project = getProjectId();
  if (!project) {
    throw new HttpsError(
      "failed-precondition",
      "Missing GCLOUD_PROJECT for image generation."
    );
  }

  genAIClient = new GoogleGenAI({ vertexai: true, project, location: DEFAULT_REGION });
  return genAIClient;
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
    const ai = getGenAIClient();
    const result = await ai.models.generateContent({
      model: DEFAULT_MODEL,
      contents: buildImagePrompt(prompt),
      config: {
        responseModalities: ["TEXT", "IMAGE"],
      },
    });
    const candidates = result.candidates ?? [];

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

    throw new HttpsError("internal", "Model returned no image data.");
  };

  return imageGenerator;
}

// Per-user request throttle for image generation.
// Note: This is instance-level memory and does not enforce limits across multiple Cloud Run instances.
// For global rate limiting across instances, consider using Firestore or Cloud SQL.
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

  const {prompt} = parseInput(request.data);

  let user: Awaited<ReturnType<typeof userRepository.getOrCreateUserByFirebaseIdentity>>;
  try {
    user = await userRepository.getOrCreateUserByFirebaseIdentity({
      firebaseUid: request.auth.uid,
      email,
      displayName: decoded.name || null,
      avatarUrl: decoded.picture || null,
    });
  } catch (error: unknown) {
    logger.error("Failed to bootstrap user identity in generateImage", {
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

  assertWithinRateLimit(request.auth.uid);

  const credits = options.creditService ?? creditService;
  const generateImage = options.generateImage ?? getImageGenerator();

  let imageResult: GeneratedImageResult;
  let spendAllocations: CreditSpendAllocation[] | null = null;
  let remainingCredits = 0;

  try {
    const charge = await chargeForImage(user.id, credits);
    spendAllocations = charge.spendAllocations;
    remainingCredits = charge.remainingCredits;

    imageResult = await generateImage(prompt);

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
    const latencyMs = Date.now() - start;

    logger.info("generateImage succeeded", {
      firebaseUid: request.auth.uid,
      userId: user.id,
      creditsSpent: 1,
      remainingCredits,
      latencyMs,
      imageBytesApprox: Math.floor(imageResult.imageBase64.length * 0.75),
    });

    const usageSnapshot = await buildUsageSnapshotForUser(
      user.id,
      subscriptionService,
      'generateImage'
    );

    return {
      imageBase64: imageResult.imageBase64,
      mimeType: normalizedMimeType,
      creditsSpent: 1,
      remainingCredits,
      ...usageSnapshot,
    };
  } catch (error) {
    if (spendAllocations) {
      try {
        await credits.refundCredit(user.id, spendAllocations);
      } catch (refundError) {
        logger.error("Failed to refund credits after generateImage failure", {
          userId: user.id,
          spendAllocations,
          error: refundError,
        });
      }
    }

    logger.error("generateImage failed", {
      userId: user.id,
      error,
    });

    if (error instanceof HttpsError) {
      throw error;
    }

    if (isVertexIamPermissionDenied(error)) {
      throw new HttpsError(
        "failed-precondition",
        "Vertex AI permission missing for generateimage runtime service account. " +
          "Grant roles/aiplatform.user and retry."
      );
    }

    throw new HttpsError("internal", "Failed to generate image.");
  }
};

export const generateImageHandler = handler;

export const generateImage = onCall(
  {
    region: DEFAULT_REGION,
    enforceAppCheck: true,
    invoker: "public",
    secrets: [...CLOUD_SQL_SECRETS],
  },
  (request) => handler(request)
);
