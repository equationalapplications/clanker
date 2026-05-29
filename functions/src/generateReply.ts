import {onCall, HttpsError, CallableRequest} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import admin from "firebase-admin";
import type {DecodedIdToken} from "firebase-admin/auth";
import { and, eq } from "drizzle-orm";
import { userRepository } from "./services/userRepository.js";
import { subscriptionService } from "./services/subscriptionService.js";
import { creditService } from "./services/creditService.js";
import { buildUsageSnapshotForUser } from "./usageSnapshot.js";
import { CLOUD_SQL_SECRETS } from "./cloudSqlSecrets.js";
import { getDb } from "./db/cloudSql.js";
import { characters, messages } from "./db/schema.js";

const DEFAULT_MODEL = "gemini-2.5-flash";
const DEFAULT_REGION = "us-central1";
const MAX_PROMPT_LENGTH = 12_000;
const MAX_OUTPUT_TOKENS = 1_024;
const MAX_STRUCTURED_PAYLOAD_SIZE = 12_000;

function validateStructuredPayloadSize(contents: unknown[], systemInstruction: string): void {
  let serialized: string;

  try {
    serialized = JSON.stringify({ contents, systemInstruction });
  } catch {
    throw new HttpsError(
      'invalid-argument',
      'Structured contents must be JSON-serializable.',
    );
  }

  const payloadSize = Buffer.byteLength(serialized, 'utf8');
  if (payloadSize > MAX_STRUCTURED_PAYLOAD_SIZE) {
    throw new HttpsError(
      'invalid-argument',
      `Structured contents and systemInstruction must serialize to at most ${MAX_STRUCTURED_PAYLOAD_SIZE} bytes.`,
    );
  }
}

function trimSystemInstruction(systemInstruction: string, contents: unknown[], maxBytes: number = MAX_STRUCTURED_PAYLOAD_SIZE): string {
  // Binary search to find the maximum prefix that fits within the budget.
  let low = 0;
  let high = systemInstruction.length;
  let best = '';

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const truncated = systemInstruction.slice(0, mid);
    const serialized = JSON.stringify({ contents, systemInstruction: truncated });
    const size = Buffer.byteLength(serialized, 'utf8');

    if (size <= maxBytes) {
      best = truncated;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return best;
}

function buildSoftBreakResponse(): GenerateReplyResponse {
  return {
    reply: "🤖 **System Update:** A massive brain upgrade is available! Please update Clanker to the latest version in the App Store to continue chatting.",
    messageId: `system-update-${Date.now()}`,
    creditsSpent: 0,
    remainingCredits: undefined,
    planTier: null,
    planStatus: null,
    verifiedAt: new Date().toISOString(),
  };
}

// Initialize the Admin SDK if not already initialized
if (!admin.apps.length) {
  admin.initializeApp();
}

interface SyncMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  createdAt: number;
}

interface GenerateReplyData {
  characterId?: string;
  prompt?: string;
  contents?: unknown[];
  systemInstruction?: string;
  unsyncedHistory?: SyncMessage[];
  referenceId?: string;
}

export interface GenerateReplyResponse {
  reply: string;
  creditsSpent: number;
  remainingCredits: number | undefined;
  planTier: string | null;
  planStatus: 'active' | 'cancelled' | 'expired' | null;
  verifiedAt: string;
  messageId?: string;
}

type GenerateTextFn = (input: {
  contents: unknown[];
  systemInstruction: string;
}) => Promise<string>;
type GetDbFn = () => Promise<Pick<Awaited<ReturnType<typeof getDb>>, 'insert' | 'select'>>;

interface GenerateReplyOptions {
  generateText?: GenerateTextFn;
  creditService?: Pick<typeof creditService, 'spendCredits' | 'refundCredit' | 'getCredits'>;
  getDb?: GetDbFn;
}

interface CandidatePart {
  text?: string;
}

interface Candidate {
  content?: {
    parts?: CandidatePart[];
  };
}

interface GenerateContentInput {
  contents: unknown[];
  systemInstruction: string;
}

interface GenerateContentResult {
  response: {
    candidates?: Candidate[];
  };
}

interface GenerativeModelLike {
  generateContent(input: GenerateContentInput): Promise<GenerateContentResult>;
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

  textGenerator = async (input: {
    contents: unknown[];
    systemInstruction: string;
  }): Promise<string> => {
    const model = await getModel();
    const result = await model.generateContent({
      contents: input.contents,
      systemInstruction: input.systemInstruction,
    });
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

function parseInput(data: unknown): {
  prompt?: string;
  contents?: unknown[];
  systemInstruction?: string;
  characterId?: string;
  unsyncedHistory?: SyncMessage[];
  referenceId?: string;
} {
  const payload = data as GenerateReplyData | undefined;
  const promptValue = payload?.prompt;
  const prompt = typeof promptValue === "string" ? promptValue.trim() : undefined;

  if (prompt !== undefined && prompt.length > MAX_PROMPT_LENGTH) {
    throw new HttpsError(
      "invalid-argument",
      `prompt must be at most ${MAX_PROMPT_LENGTH} characters.`
    );
  }

  const contentsValue = payload?.contents;
  let contents: unknown[] | undefined;
  if (contentsValue !== undefined) {
    if (!Array.isArray(contentsValue)) {
      throw new HttpsError("invalid-argument", "contents must be an array when provided.");
    }

    if (contentsValue.length === 0) {
      throw new HttpsError("invalid-argument", "contents must not be empty.");
    }

    contents = contentsValue;
  }

  const systemInstructionValue = payload?.systemInstruction;
  let systemInstruction =
    typeof systemInstructionValue === "string" ? systemInstructionValue.trim() : undefined;
  const rawReferenceId = payload?.referenceId;
  const referenceId = typeof rawReferenceId === 'string' ? rawReferenceId.trim() : undefined;

  if (!prompt && contents === undefined) {
    throw new HttpsError(
      "invalid-argument",
      "prompt or structured contents are required.",
    );
  }

  if (contents !== undefined && !systemInstruction) {
    throw new HttpsError(
      "invalid-argument",
      "systemInstruction is required when contents are provided.",
    );
  }

  if (contents === undefined && systemInstruction !== undefined) {
    throw new HttpsError(
      "invalid-argument",
      "Structured contents and systemInstruction are required together.",
    );
  }

  if (contents !== undefined && systemInstruction !== undefined) {
    // Trim systemInstruction if needed to fit within the payload budget.
    // This ensures large character context or memory blocks don't cause every request to fail.
    const trimmedSystemInstruction = trimSystemInstruction(systemInstruction, contents);
    if (trimmedSystemInstruction !== systemInstruction) {
      logger.warn('systemInstruction was truncated to fit within payload budget');
      systemInstruction = trimmedSystemInstruction;
    }
    validateStructuredPayloadSize(contents, systemInstruction);
  }

  const characterId = typeof payload?.characterId === 'string' ? payload.characterId : undefined;
  const rawHistory = payload?.unsyncedHistory;
  let unsyncedHistory: SyncMessage[] | undefined;

  if (rawHistory !== undefined) {
    if (!Array.isArray(rawHistory)) {
      throw new HttpsError("invalid-argument", "unsyncedHistory must be an array when provided.");
    }

    unsyncedHistory = (rawHistory as unknown[]).map((item, index): SyncMessage => {
      if (item === null || typeof item !== 'object') {
        throw new HttpsError(
          "invalid-argument",
          `unsyncedHistory[${index}] must be an object containing a user message.`,
        );
      }

      const message = item as SyncMessage;
      if (
        typeof message.id !== 'string' ||
        message.role !== 'user' ||
        typeof message.text !== 'string' ||
        typeof message.createdAt !== 'number'
      ) {
        throw new HttpsError(
          "invalid-argument",
          `unsyncedHistory[${index}] must contain only user-role messages with string id/text and numeric createdAt.`,
        );
      }

      return message;
    });
  }

  return { prompt, contents, systemInstruction, characterId, unsyncedHistory, referenceId };
}

async function chargeForReply(
  userId: string,
  credits: Pick<typeof creditService, 'spendCredits' | 'refundCredit' | 'getCredits'>
): Promise<{transactionId: string; remainingCredits: number}> {
  const transactionId = await credits.spendCredits(userId, 1);
  if (transactionId === null) {
    throw new HttpsError("failed-precondition", "Insufficient credits.");
  }

  const remainingCredits = await credits.getCredits(userId);
  return { transactionId, remainingCredits };
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

  const parsed = parseInput(request.data);
  const { prompt, characterId, unsyncedHistory } = parsed;
  let { contents, systemInstruction } = parsed;

  if (prompt && !contents) {
    // Legacy prompt callers must upgrade to structured payloads.
    return buildSoftBreakResponse();
  }

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

  // Bulk insert unsynced edge messages with idempotency guard
  if (unsyncedHistory && unsyncedHistory.length > 0 && characterId) {
    const getDbFn = options.getDb ?? getDb;
    const db = await getDbFn();

    // Verify the character belongs to the authenticated user before accepting client-supplied history.
    const ownedCharacter = await db
      .select({ id: characters.id })
      .from(characters)
      .where(and(eq(characters.id, characterId), eq(characters.userId, user.id)))
      .limit(1);

    if (!ownedCharacter[0]) {
      throw new HttpsError(
        "permission-denied",
        "Character does not belong to the authenticated user."
      );
    }

    const userMessages = unsyncedHistory.filter((msg) => msg.role === 'user');
    if (userMessages.length > 0) {
      try {
        await db.insert(messages)
          .values(userMessages.map((msg) => ({
            messageId: msg.id,
            characterId,
            senderUserId: user.id,
            text: msg.text,
            createdAt: new Date(msg.createdAt),
            messageData: {},
          })))
          .onConflictDoNothing({ target: messages.messageId });
      } catch (insertError) {
        logger.warn("Failed to bulk insert unsynced history; continuing with reply generation", {
          userId: user.id,
          error: insertError,
        });
      }
    }
  }

  const credits = options.creditService ?? creditService;
  const generateText = options.generateText ?? getTextGenerator();

  let reply: string;
  let transactionId: string | null = null;
  let remainingCredits = 0;

  try {
    const charge = await chargeForReply(user.id, credits);
    transactionId = charge.transactionId;
    remainingCredits = charge.remainingCredits;

    reply = (
      await generateText({
        contents: contents ?? [],
        systemInstruction: systemInstruction ?? '',
      })
    ).trim();
    if (!reply) {
      throw new HttpsError("internal", "Model returned an empty chat response.");
    }

    const usageSnapshot = await buildUsageSnapshotForUser(
      user.id,
      subscriptionService,
      'generateReply'
    );

    return {
      reply,
      creditsSpent: 1,
      remainingCredits,
      ...usageSnapshot,
    };
  } catch (error) {
    if (transactionId) {
      try {
        await credits.refundCredit(user.id, transactionId, 1);
      } catch (refundError) {
        logger.error("Failed to refund credits after generateReply failure", {
          userId: user.id,
          transactionId,
          error: refundError,
        });
      }
    }

    if (error instanceof HttpsError) {
      throw error;
    }

    logger.error("generateReply failed", {
      userId: user.id,
      error,
    });

    throw new HttpsError("internal", "Failed to generate chat response.");
  }
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
