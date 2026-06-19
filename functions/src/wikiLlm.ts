import {onCall, HttpsError, CallableRequest} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import type {DecodedIdToken} from "firebase-admin/auth";
import { GoogleGenAI, Type } from "@google/genai";
import {userRepository} from "./services/userRepository.js";
import {creditService as defaultCreditService} from "./services/creditService.js";
import {CLOUD_SQL_SECRETS} from "./cloudSqlSecrets.js";

const DEFAULT_MODEL = "gemini-3-flash-preview";
const DEFAULT_REGION = "us-central1";
const MAX_OUTPUT_TOKENS = 2_048;
const MAX_SYSTEM_PROMPT_LENGTH = 32_000;
const MAX_USER_PROMPT_LENGTH = 500_000;

interface WikiLlmRequest {
  systemPrompt: string;
  userPrompt: string;
}

export interface WikiLlmResponse {
  text: string;
}

function parseInput(data: unknown): WikiLlmRequest {
  if (!data || typeof data !== "object") {
    throw new HttpsError("invalid-argument", "Request body must be an object.");
  }

  const d = data as Record<string, unknown>;
  const systemPrompt = d.systemPrompt;
  const userPrompt = d.userPrompt;

  if (typeof systemPrompt !== "string") {
    throw new HttpsError("invalid-argument", "systemPrompt is required.");
  }
  const trimmedSystemPrompt = systemPrompt.trim();
  if (trimmedSystemPrompt.length === 0) {
    throw new HttpsError("invalid-argument", "systemPrompt is required.");
  }
  if (trimmedSystemPrompt.length > MAX_SYSTEM_PROMPT_LENGTH) {
    throw new HttpsError("invalid-argument", `systemPrompt must be at most ${MAX_SYSTEM_PROMPT_LENGTH} characters.`);
  }

  if (typeof userPrompt !== "string") {
    throw new HttpsError("invalid-argument", "userPrompt is required.");
  }
  const trimmedUserPrompt = userPrompt.trim();
  if (trimmedUserPrompt.length === 0) {
    throw new HttpsError("invalid-argument", "userPrompt is required.");
  }
  if (trimmedUserPrompt.length > MAX_USER_PROMPT_LENGTH) {
    throw new HttpsError("invalid-argument", `userPrompt must be at most ${MAX_USER_PROMPT_LENGTH} characters.`);
  }

  return {systemPrompt: trimmedSystemPrompt, userPrompt: trimmedUserPrompt};
}

interface WikiLlmOptions {
  model?: string;
  generateText?: (systemPrompt: string, userPrompt: string) => Promise<string>;
  getUser?: typeof userRepository.getOrCreateUserByFirebaseIdentity;
  creditService?: Pick<typeof defaultCreditService, "spendCredits" | "refundCredit">;
}

let genAIClient: GoogleGenAI | undefined;

function getGenAIClient(): GoogleGenAI {
  if (genAIClient) {
    return genAIClient;
  }

  const project = process.env.GCLOUD_PROJECT ?? process.env.GCP_PROJECT;
  if (!project) {
    throw new HttpsError("failed-precondition", "Missing GCLOUD_PROJECT for wiki LLM.");
  }

  genAIClient = new GoogleGenAI({ vertexai: true, project, location: DEFAULT_REGION });
  return genAIClient;
}

function getTextGenerator(model = DEFAULT_MODEL) {
  return async (systemPrompt: string, userPrompt: string): Promise<string> => {
    const ai = getGenAIClient();
    const result = await ai.models.generateContent({
      model,
      contents: [{role: "user", parts: [{text: userPrompt}]}],
      config: {
        systemInstruction: systemPrompt,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        temperature: 0,
        responseMimeType: "application/json",
        responseSchema: {type: Type.OBJECT},
      },
    });

    const candidates = result.candidates ?? [];
    for (const candidate of candidates) {
      const parts = candidate.content?.parts ?? [];
      const text = parts
        .map((p) => (typeof p.text === "string" ? p.text : ""))
        .join("")
        .trim();
      if (text) return text;
    }

    throw new HttpsError("internal", "Model returned an empty response.");
  };
}

export const wikiLlmHandler = async (
  request: CallableRequest,
  options: WikiLlmOptions = {}
): Promise<WikiLlmResponse> => {
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

  const {systemPrompt, userPrompt} = parseInput(request.data);

  const getUser = options.getUser ?? ((args) => userRepository.getOrCreateUserByFirebaseIdentity(args));
  const credits = options.creditService ?? defaultCreditService;

  let user: Awaited<ReturnType<typeof userRepository.getOrCreateUserByFirebaseIdentity>>;
  try {
    user = await getUser({
      firebaseUid: request.auth.uid,
      email,
      displayName: decoded.name || null,
      avatarUrl: decoded.picture || null,
    });
  } catch (error: unknown) {
    logger.error("Failed to bootstrap user in wikiLlm", {firebaseUid: request.auth.uid, error});
    throw new HttpsError("internal", "Failed to bootstrap user.");
  }

  const transactionId = await credits.spendCredits(user.id, 1);
  if (transactionId === null) {
    throw new HttpsError("failed-precondition", "Insufficient credits.");
  }

  const generateText = options.generateText ?? getTextGenerator(options.model);
  let text: string;
  try {
    text = await generateText(systemPrompt, userPrompt);
    if (!text) {
      throw new HttpsError("internal", "Model returned an empty response.");
    }
  } catch (error) {
    logger.error("wikiLlm model call failed", {userId: user.id, error});
    try {
      await credits.refundCredit(user.id, transactionId, 1);
    } catch (refundError) {
      logger.error("Failed to refund credits after wikiLlm failure", {
        userId: user.id,
        transactionId,
        error: refundError,
      });
    }

    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", "Failed to generate wiki response.");
  }

  return {text};
};

export const wikiLlm = onCall(
  {
    region: DEFAULT_REGION,
    enforceAppCheck: true,
    invoker: "public",
    secrets: [...CLOUD_SQL_SECRETS],
  },
  (request) => wikiLlmHandler(request)
);
