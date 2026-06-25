import {onCall, HttpsError, CallableRequest} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import admin from "firebase-admin";
import type {DecodedIdToken} from "firebase-admin/auth";
import { and, eq } from "drizzle-orm";
import { GoogleGenAI } from "@google/genai";
import type { Content, GroundingMetadata, Tool } from "@google/genai";
import { buildAuthorizedToolsArray, googleSearchManifest } from "@equationalapplications/core-llm-tools";
import type { GeminiToolEntry } from "@equationalapplications/core-llm-tools";
import { userRepository } from "./services/userRepository.js";
import { subscriptionService } from "./services/subscriptionService.js";
import { creditService } from "./services/creditService.js";
import { buildUsageSnapshotForUser } from "./usageSnapshot.js";
import { CLOUD_SQL_SECRETS } from "./cloudSqlSecrets.js";
import { getDb } from "./db/cloudSql.js";
import { characters, messages } from "./db/schema.js";

const DEFAULT_MODEL = "gemini-3.5-flash";
const DEFAULT_REGION = "us-central1";
// Gemini 3 family is currently global-only on Vertex AI (no us-central1
// regional serving yet); DEFAULT_REGION above still governs the Cloud
// Function's own deploy region, unrelated to this.
const GEMINI_LOCATION = "global";
const MAX_PROMPT_LENGTH = 12_000;
const MAX_OUTPUT_TOKENS = 1_024;
const MAX_STRUCTURED_PAYLOAD_SIZE = 12_000;

// Mirrors the 'both' + 'edge-only' tier tool names from shared/agent-tools-spec.ts.
// Hardcoded rather than imported: functions/'s tsconfig.json has rootDir: "src" and
// cannot reach the repo-root shared/ directory without restructuring its build. The
// client already builds the schema array itself via getSchemasForEdge() and sends it
// as data, so the server only needs to defend against unexpected tool *names*.
const ALLOWED_TOOL_NAMES = new Set([
  "get_current_time",
  "wiki_read",
  "wiki_write",
  "create_task",
  "list_tasks",
  "update_task",
  "complete_task",
  "delete_task",
  "document_search",
  "escalate_to_cloud_agent",
  "wiki_get_ontology",
  "wiki_traverse_graph",
]);

interface ToolDeclaration {
  name: string;
  description: string;
  parameters: object;
}

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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateStructuredContents(contents: unknown[]): void {
  for (const [index, item] of contents.entries()) {
    if (!isPlainObject(item)) {
      throw new HttpsError("invalid-argument", `contents[${index}] must be an object.`);
    }

    const parts = (item as { parts?: unknown }).parts;
    if (!Array.isArray(parts)) {
      throw new HttpsError(
        "invalid-argument",
        `contents[${index}].parts must be an array of text parts.`,
      );
    }

    if (parts.length === 0) {
      throw new HttpsError(
        "invalid-argument",
        `contents[${index}].parts must not be empty.`,
      );
    }

    for (const [partIndex, part] of parts.entries()) {
      if (!isPlainObject(part)) {
        throw new HttpsError(
          "invalid-argument",
          `contents[${index}].parts[${partIndex}] must be an object with a text string, functionCall, or functionResponse.`,
        );
      }

      const text = (part as { text?: unknown }).text;
      if (typeof text === "string") {
        continue;
      }

      const functionCall = (part as { functionCall?: unknown }).functionCall;
      if (isPlainObject(functionCall) && typeof (functionCall as { name?: unknown }).name === "string") {
        continue;
      }

      const functionResponse = (part as { functionResponse?: unknown }).functionResponse;
      if (
        isPlainObject(functionResponse) &&
        typeof (functionResponse as { name?: unknown }).name === "string" &&
        isPlainObject((functionResponse as { response?: unknown }).response)
      ) {
        continue;
      }

      throw new HttpsError(
        "invalid-argument",
        `contents[${index}].parts[${partIndex}] must be an object with a text string, functionCall, or functionResponse.`,
      );
    }
  }
}

function validateToolsPayloadSize(tools: ToolDeclaration[]): void {
  let serialized: string;

  try {
    serialized = JSON.stringify(tools);
  } catch {
    throw new HttpsError("invalid-argument", "tools must be JSON-serializable.");
  }

  const payloadSize = Buffer.byteLength(serialized, "utf8");
  if (payloadSize > MAX_STRUCTURED_PAYLOAD_SIZE) {
    throw new HttpsError(
      "invalid-argument",
      `tools must serialize to at most ${MAX_STRUCTURED_PAYLOAD_SIZE} bytes.`,
    );
  }
}

function validateTools(tools: unknown[]): ToolDeclaration[] {
  return tools.map((tool, index) => {
    if (!isPlainObject(tool)) {
      throw new HttpsError("invalid-argument", `tools[${index}] must be an object.`);
    }
    const t = tool as Record<string, unknown>;
    if (typeof t.name !== "string" || typeof t.description !== "string" || !isPlainObject(t.parameters)) {
      throw new HttpsError(
        "invalid-argument",
        `tools[${index}] must have a string name, string description, and object parameters.`,
      );
    }
    if (!ALLOWED_TOOL_NAMES.has(t.name)) {
      throw new HttpsError("invalid-argument", `tools[${index}].name "${t.name}" is not a recognized tool.`);
    }
    return { name: t.name, description: t.description, parameters: t.parameters as object };
  });
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
  tools?: unknown[];
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
  groundingMetadata?: GroundingMetadata;
  functionCalls?: { name: string; args?: Record<string, unknown> }[];
}

type GenerateTextResult =
  | { text: string; groundingMetadata?: GroundingMetadata; functionCalls?: undefined }
  | { functionCalls: { name: string; args?: Record<string, unknown> }[]; text?: undefined; groundingMetadata?: undefined };

type GenerateTextFn = (input: {
  contents: unknown[];
  systemInstruction: string;
  tools?: ToolDeclaration[];
}) => Promise<GenerateTextResult>;
type GetDbFn = () => Promise<Pick<Awaited<ReturnType<typeof getDb>>, 'insert' | 'select'>>;

interface GenerateReplyOptions {
  generateText?: GenerateTextFn;
  creditService?: Pick<typeof creditService, 'spendCredits' | 'refundCredit' | 'getCredits'>;
  getDb?: GetDbFn;
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
  return [
    process.env.GCLOUD_PROJECT,
    process.env.GCP_PROJECT,
    process.env.GOOGLE_CLOUD_PROJECT,
  ]
    .map((v) => v?.trim())
    .find((v): v is string => Boolean(v));
}

let textGenerator: GenerateTextFn | undefined;
let genAIClient: GoogleGenAI | undefined;

function getGenAIClient(): GoogleGenAI {
  if (genAIClient) {
    return genAIClient;
  }

  const project = getProjectId();
  if (!project) {
    throw new HttpsError(
      "failed-precondition",
      "Missing project env (GCLOUD_PROJECT, GCP_PROJECT, or GOOGLE_CLOUD_PROJECT) for Vertex AI chat response generation."
    );
  }

  genAIClient = new GoogleGenAI({ vertexai: true, project, location: GEMINI_LOCATION });
  return genAIClient;
}

export function toGenAITool(entry: GeminiToolEntry): Tool {
  if ('google_search' in entry) {
    return { googleSearch: {} };
  }
  if ('functionDeclarations' in entry) {
    return { functionDeclarations: entry.functionDeclarations as Tool['functionDeclarations'] };
  }
  throw new Error('Unsupported tool entry');
}

export function buildToolsForRequest(tools?: ToolDeclaration[]): Tool[] {
  if (tools && tools.length > 0) {
    return [{ functionDeclarations: tools as Tool['functionDeclarations'] }];
  }
  return buildAuthorizedToolsArray([googleSearchManifest], []).map(toGenAITool);
}

function getTextGenerator(): GenerateTextFn {
  if (textGenerator) {
    return textGenerator;
  }

  const generator: GenerateTextFn = async (input: {
    contents: unknown[];
    systemInstruction: string;
    tools?: ToolDeclaration[];
  }) => {
    const ai = getGenAIClient();
    const tools = buildToolsForRequest(input.tools);

    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await ai.models.generateContent({
        model: DEFAULT_MODEL,
        contents: input.contents as Content[],
        config: {
          systemInstruction: input.systemInstruction,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          thinkingConfig: { thinkingBudget: 0 },
          tools,
        },
      });

      if (result.functionCalls && result.functionCalls.length > 0) {
        return {
          functionCalls: result.functionCalls.map((fc) => ({
            name: fc.name ?? "",
            args: fc.args as Record<string, unknown> | undefined,
          })),
        };
      }

      const candidates = result.candidates ?? [];

      for (const candidate of candidates) {
        const parts = candidate.content?.parts ?? [];
        const text = parts
          .map((part) => (typeof part.text === "string" ? part.text : ""))
          .join("")
          .trim();

        if (text.length > 0) {
          return { text, groundingMetadata: candidate.groundingMetadata };
        }
      }

      if (attempt === 0) {
        logger.warn("generateReply empty model response, retrying once", {
          finishReasons: candidates.map((c) => c.finishReason ?? null),
          candidateCount: candidates.length,
        });
        continue;
      }

      logger.error("generateReply model returned empty response after retry", {
        finishReasons: candidates.map((c) => c.finishReason ?? null),
        candidateCount: candidates.length,
      });
    }

    throw new HttpsError("internal", "Model returned an empty response.");
  };

  textGenerator = generator;
  return generator;
}

function parseInput(data: unknown): {
  prompt?: string;
  contents?: unknown[];
  systemInstruction?: string;
  tools?: ToolDeclaration[];
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

    validateStructuredContents(contentsValue);
    contents = contentsValue;
  }

  const toolsValue = payload?.tools;
  let tools: ToolDeclaration[] | undefined;
  if (toolsValue !== undefined) {
    if (!Array.isArray(toolsValue)) {
      throw new HttpsError("invalid-argument", "tools must be an array when provided.");
    }
    tools = validateTools(toolsValue);
    validateToolsPayloadSize(tools);
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

  if (rawHistory != null) {
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

  return { prompt, contents, systemInstruction, tools, characterId, unsyncedHistory, referenceId };
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
  const { prompt, characterId, unsyncedHistory, contents, systemInstruction, tools } = parsed;

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

    const generated = await generateText({
      contents: contents ?? [],
      systemInstruction: systemInstruction ?? '',
      tools,
    });

    if (generated.functionCalls && generated.functionCalls.length > 0) {
      const usageSnapshot = await buildUsageSnapshotForUser(
        user.id,
        subscriptionService,
        'generateReply'
      );

      return {
        reply: '',
        functionCalls: generated.functionCalls,
        creditsSpent: 1,
        remainingCredits,
        ...usageSnapshot,
      };
    }

    reply = (generated.text ?? '').trim();
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
      groundingMetadata: generated.groundingMetadata,
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
