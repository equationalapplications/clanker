import {onCall, HttpsError, CallableRequest} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import admin from "firebase-admin";
import type {DecodedIdToken} from "firebase-admin/auth";
import {userRepository} from "./services/userRepository.js";
import {subscriptionService} from "./services/subscriptionService.js";
import {creditService} from "./services/creditService.js";
import {CLOUD_SQL_SECRETS} from "./cloudSqlSecrets.js";

const UNLIMITED_TIERS = new Set(["monthly_20", "monthly_50"]);
const TEXT_MODEL = "gemini-2.5-flash";
const TTS_MODEL = "gemini-2.5-flash-tts";
const DEFAULT_REGION = "us-central1";
const MAX_PROMPT_LENGTH = 12_000;
const MAX_REFERENCE_ID_LENGTH = 128;
const MAX_OUTPUT_TOKENS = 1_024;

if (!admin.apps.length) {
  admin.initializeApp();
}

interface GenerateVoiceReplyData {
  prompt: string;
  characterVoice: string;
  characterTraits?: string;
  characterEmotions?: string;
  referenceId?: string;
}

interface UsageState {
  planTier: string | null;
  planStatus: "active" | "cancelled" | "expired";
  hasUnlimited: boolean;
  creditBalance: number;
}

interface UsageSnapshotDetails {
  remainingCredits: number | null;
  planTier: string | null;
  planStatus: "active" | "cancelled" | "expired";
  verifiedAt: string;
}

export interface GenerateVoiceReplyResponse {
  replyText: string;
  rawReplyText: string;
  audioBase64: string;
  audioMimeType: string;
  creditsSpent: number;
  remainingCredits: number | null;
  planTier: string | null;
  planStatus: "active" | "cancelled" | "expired";
  verifiedAt: string;
}

type GenerateTextFn = (prompt: string) => Promise<string>;
type SynthesizeSpeechFn = (text: string, voice: string) => Promise<{audioBase64: string; audioMimeType: string}>;

interface GenerateVoiceReplyOptions {
  generateText?: GenerateTextFn;
  synthesizeSpeech?: SynthesizeSpeechFn;
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

function normalizePlanStatus(status: string | null | undefined): UsageState["planStatus"] {
  if (status === "active" || status === "cancelled" || status === "expired") {
    return status;
  }

  return "expired";
}

function getProjectId(): string | undefined {
  const fromEnv = process.env.GCLOUD_PROJECT ?? process.env.GCP_PROJECT;
  const value = fromEnv?.trim();
  return value ? value : undefined;
}

interface GenAiClientLike {
  models: {
    generateContent: (payload: Record<string, unknown>) => Promise<{
      candidates?: Array<{
        content?: {
          parts?: Array<{
            inlineData?: {
              data?: string;
              mimeType?: string;
            };
          }>;
        };
      }>;
    }>;
  };
}

let textGenerator: GenerateTextFn | undefined;
let modelPromise: Promise<GenerativeModelLike> | undefined;
let genAiClientPromise: Promise<GenAiClientLike> | undefined;
let speechSynthesizer: SynthesizeSpeechFn | undefined;

async function getModel(): Promise<GenerativeModelLike> {
  if (modelPromise) {
    return modelPromise;
  }

  const project = getProjectId();
  if (!project) {
    throw new HttpsError(
      "failed-precondition",
      "Missing GCLOUD_PROJECT for Vertex AI voice reply generation."
    );
  }

  modelPromise = (async () => {
    try {
      const moduleName = "@google-cloud/vertexai";
      const vertexModule = await import(moduleName) as VertexAIModule;
      const vertex = new vertexModule.VertexAI({project, location: DEFAULT_REGION});

      return vertex.getGenerativeModel({
        model: TEXT_MODEL,
        generationConfig: {
          maxOutputTokens: MAX_OUTPUT_TOKENS,
        },
      });
    } catch (error: unknown) {
      modelPromise = undefined;
      const message = toErrorMessage(error);

      const missingVertexModule =
        (error instanceof Error && ("code" in error && error.code === "MODULE_NOT_FOUND")) ||
        message.includes("@google-cloud/vertexai");

      if (missingVertexModule) {
        throw new HttpsError(
          "failed-precondition",
          "The @google-cloud/vertexai package is not available."
        );
      }

      if (error instanceof HttpsError) {
        throw error;
      }

      throw new HttpsError("internal", `Failed to initialize Vertex AI model: ${message}`);
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

async function getGenAiClient(): Promise<GenAiClientLike> {
  if (genAiClientPromise) {
    return genAiClientPromise;
  }

  const project = getProjectId();
  if (!project) {
    throw new HttpsError(
      "failed-precondition",
      "Missing GCLOUD_PROJECT for Vertex AI speech synthesis."
    );
  }

  genAiClientPromise = (async () => {
    try {
      const moduleName = "@google/genai";
      const genAiModule = await import(moduleName) as {
        GoogleGenAI: new (config: Record<string, unknown>) => GenAiClientLike;
      };
      return new genAiModule.GoogleGenAI({
        vertexai: true,
        project,
        location: DEFAULT_REGION,
      });
    } catch (error: unknown) {
      genAiClientPromise = undefined;
      if (error instanceof HttpsError) {
        throw error;
      }
      throw new HttpsError("internal", `Failed to initialize Google GenAI client: ${toErrorMessage(error)}`);
    }
  })();

  return genAiClientPromise;
}

const DEFAULT_PCM_SAMPLE_RATE = 24_000;
const DEFAULT_PCM_CHANNELS = 1;
const DEFAULT_PCM_BITS_PER_SAMPLE = 16;

function isRawPcmMimeType(mimeType: string): boolean {
  const normalized = mimeType.toLowerCase();
  return normalized.startsWith("audio/l16") || normalized.startsWith("audio/pcm");
}

function parsePcmParam(mimeType: string, key: string): number | null {
  const match = mimeType.toLowerCase().match(new RegExp(`(?:^|;)\\s*${key}\\s*=\\s*(\\d+)`));
  if (!match) {
    return null;
  }
  const value = Number.parseInt(match[1], 10);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function buildWavHeader(
  pcmByteLength: number,
  sampleRate: number,
  numChannels: number,
  bitsPerSample: number
): Buffer {
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);

  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcmByteLength, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16); // PCM subchunk size
  header.writeUInt16LE(1, 20); // PCM format
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcmByteLength, 40);

  return header;
}

function wrapPcmAsWav(pcmBase64: string, mimeType: string): string {
  const pcm = Buffer.from(pcmBase64, "base64");
  const sampleRate = parsePcmParam(mimeType, "rate") ?? DEFAULT_PCM_SAMPLE_RATE;
  const numChannels = parsePcmParam(mimeType, "channels") ?? DEFAULT_PCM_CHANNELS;
  const bitsPerSample = parsePcmParam(mimeType, "bits") ?? DEFAULT_PCM_BITS_PER_SAMPLE;

  if (!Number.isInteger(sampleRate) || sampleRate <= 0) {
    throw new HttpsError("internal", `Unsupported PCM sample rate: ${sampleRate}`);
  }
  if (!Number.isInteger(numChannels) || numChannels <= 0) {
    throw new HttpsError("internal", `Unsupported PCM channel count: ${numChannels}`);
  }
  if (!Number.isInteger(bitsPerSample) || bitsPerSample <= 0 || bitsPerSample % 8 !== 0) {
    throw new HttpsError("internal", `Unsupported PCM bits per sample: ${bitsPerSample}`);
  }

  const header = buildWavHeader(pcm.length, sampleRate, numChannels, bitsPerSample);
  return Buffer.concat([header, pcm]).toString("base64");
}


function getSpeechSynthesizer(): SynthesizeSpeechFn {
  if (speechSynthesizer) {
    return speechSynthesizer;
  }

  speechSynthesizer = async (text: string, voice: string) => {
    try {
      const client = await getGenAiClient();

      const response = await client.models.generateContent({
        model: TTS_MODEL,
        contents: [
          {
            role: "user",
            parts: [{text}],
          },
        ],
        config: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: voice,
              },
            },
          },
        },
      });

      const candidates = response.candidates ?? [];
      for (const candidate of candidates) {
        const parts = candidate.content?.parts ?? [];
        for (const part of parts) {
          const base64 = part.inlineData?.data?.trim();
          if (base64) {
            const rawMimeType = part.inlineData?.mimeType?.trim() || "audio/wav";
            // Gemini TTS returns raw PCM (e.g. "audio/L16;codec=pcm;rate=24000"),
            // which browsers cannot play directly. Wrap as WAV when raw PCM is
            // detected so all clients (web + native) get a playable container.
            if (isRawPcmMimeType(rawMimeType)) {
              const wrapped = wrapPcmAsWav(base64, rawMimeType);
              return {
                audioBase64: wrapped,
                audioMimeType: "audio/wav",
              };
            }

            return {
              audioBase64: base64,
              audioMimeType: rawMimeType,
            };
          }
        }
      }

      throw new HttpsError("internal", "TTS model returned no audio.");
    } catch (error: unknown) {
      if (error instanceof HttpsError) {
        throw error;
      }

      throw new HttpsError("internal", `Failed to synthesize speech: ${toErrorMessage(error)}`);
    }
  };

  return speechSynthesizer;
}

function parseInput(data: unknown): {
  prompt: string;
  characterVoice: string;
  characterTraits: string;
  characterEmotions: string;
  referenceId: string | null;
} {
  const payload = data as GenerateVoiceReplyData | undefined;
  const promptValue = payload?.prompt;
  const voiceValue = payload?.characterVoice;

  const prompt = typeof promptValue === "string" ? promptValue.trim() : "";
  const characterVoice = typeof voiceValue === "string" ? voiceValue.trim() : "";

  if (!prompt) {
    throw new HttpsError("invalid-argument", "prompt must be a non-empty string.");
  }
  if (!characterVoice) {
    throw new HttpsError("invalid-argument", "characterVoice must be a non-empty string.");
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
    characterVoice,
    characterTraits: typeof payload?.characterTraits === "string" ? payload.characterTraits.trim() : "",
    characterEmotions: typeof payload?.characterEmotions === "string" ? payload.characterEmotions.trim() : "",
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
  if (!usage.hasUnlimited && usage.creditBalance < 2) {
    throw new HttpsError(
      "resource-exhausted",
      "Insufficient credits. Voice replies cost 2 credits.",
      toUsageSnapshotDetails(usage)
    );
  }
}

async function spendCreditsIfRequired(
  userId: string,
  usage: UsageState,
  referenceId: string | null
): Promise<number | null> {
  if (usage.hasUnlimited) {
    return null;
  }

  try {
    const success = await creditService.spendCredits(userId, 2, "voice reply", referenceId ?? undefined);
    if (!success) {
      throw new HttpsError("resource-exhausted", "Insufficient credits to complete voice reply.");
    }

    return await creditService.getCredits(userId);
  } catch (error) {
    if (error instanceof HttpsError) {
      throw error;
    }

    logger.error("Failed to spend credits for voice reply.", {
      userId,
      referenceId,
      error,
    });

    throw new HttpsError("internal", "Failed to spend credits for voice reply.");
  }
}

function cleanReplyText(rawText: string): string {
  return rawText.replace(/\[[^\]]+\]/g, " ").replace(/\s+/g, " ").trim();
}

const handler = async (
  request: CallableRequest,
  options: GenerateVoiceReplyOptions = {}
): Promise<GenerateVoiceReplyResponse> => {
  if (!request.auth) {
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

  const input = parseInput(request.data);

  let user: Awaited<ReturnType<typeof userRepository.getOrCreateUserByFirebaseIdentity>>;
  try {
    user = await userRepository.getOrCreateUserByFirebaseIdentity({
      firebaseUid: request.auth.uid,
      email,
      displayName: decoded.name || null,
      avatarUrl: decoded.picture || null,
    });
  } catch (error: unknown) {
    logger.error("Failed to bootstrap user identity in generateVoiceReply", {
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
  const synthesizeSpeech = options.synthesizeSpeech ?? getSpeechSynthesizer();

  let rawReplyText: string;
  try {
    rawReplyText = (await generateText(input.prompt)).trim();
  } catch (error) {
    logger.error("generateVoiceReply text stage failed", {userId: user.id, error});
    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError("internal", "Failed to generate voice reply text.");
  }

  if (!rawReplyText) {
    throw new HttpsError("internal", "Model returned an empty voice reply.");
  }

  const replyText = cleanReplyText(rawReplyText) || rawReplyText;
  const styleHints = [input.characterTraits, input.characterEmotions]
    .filter((part): part is string => !!part)
    .join(", ");
  const speechInput = styleHints
    ? `Speak with these qualities: ${styleHints}\n\n${replyText}`
    : replyText;

  const audio = await synthesizeSpeech(speechInput, input.characterVoice);

  const remainingCredits = await spendCreditsIfRequired(user.id, usage, input.referenceId);

  return {
    replyText,
    rawReplyText,
    audioBase64: audio.audioBase64,
    audioMimeType: audio.audioMimeType,
    creditsSpent: usage.hasUnlimited ? 0 : 2,
    remainingCredits,
    planTier: usage.planTier,
    planStatus: usage.planStatus,
    verifiedAt: new Date().toISOString(),
  };
};

export const generateVoiceReplyHandler = handler;

// Exported only for unit testing. Do not use in production code.
export const __test__ = {
  isRawPcmMimeType,
  buildWavHeader,
  wrapPcmAsWav,
} as const;

export const generateVoiceReply = onCall(
  {
    region: DEFAULT_REGION,
    enforceAppCheck: true,
    invoker: "public",
    secrets: [...CLOUD_SQL_SECRETS],
  },
  (request) => handler(request)
);
