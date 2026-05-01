import {onCall, HttpsError, CallableRequest} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import type {DecodedIdToken} from "firebase-admin/auth";
import {CLOUD_SQL_SECRETS} from "./cloudSqlSecrets.js";
import {userRepository} from "./services/userRepository.js";
import {subscriptionService} from "./services/subscriptionService.js";
import {PREMIUM_TIERS} from "./constants/plans.js";

const DEFAULT_MODEL = "gemini-2.5-flash";
const DEFAULT_REGION = "us-central1";
const MAX_OUTPUT_TOKENS = 2_048;

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

  if (typeof systemPrompt !== "string" || systemPrompt.trim().length === 0) {
    throw new HttpsError("invalid-argument", "systemPrompt is required.");
  }

  if (typeof userPrompt !== "string" || userPrompt.trim().length === 0) {
    throw new HttpsError("invalid-argument", "userPrompt is required.");
  }

  return {systemPrompt: systemPrompt.trim(), userPrompt: userPrompt.trim()};
}

interface VertexGenerateOptions {
  model?: string;
  generateText?: (systemPrompt: string, userPrompt: string) => Promise<string>;
  getUser?: typeof userRepository.getOrCreateUserByFirebaseIdentity;
  getSubscription?: typeof subscriptionService.getSubscription;
}

function getTextGenerator(model = DEFAULT_MODEL) {
  return async (systemPrompt: string, userPrompt: string): Promise<string> => {
    // Dynamic import to allow mocking in tests
    const {VertexAI} = await import("@google-cloud/vertexai");
    const project = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "";
    const vertexAI = new VertexAI({project, location: DEFAULT_REGION});
    const generativeModel = vertexAI.getGenerativeModel({
      model,
      generationConfig: {maxOutputTokens: MAX_OUTPUT_TOKENS},
    });

    const result = await generativeModel.generateContent({
      contents: [{role: "user", parts: [{text: userPrompt}]}],
      systemInstruction: systemPrompt,
    });

    const candidates = result.response.candidates ?? [];
    for (const candidate of candidates) {
      const parts = candidate.content?.parts ?? [];
      const text = parts
        .map((p: {text?: string}) => (typeof p.text === "string" ? p.text : ""))
        .join("")
        .trim();
      if (text) return text;
    }

    throw new HttpsError("internal", "Vertex AI returned an empty response.");
  };
}

export const wikiLlmHandler = async (
  request: CallableRequest,
  options: VertexGenerateOptions = {}
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
  const getSubscription = options.getSubscription ?? ((userId) => subscriptionService.getSubscription(userId));

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

  const subscription = await getSubscription(user.id);
  const isUnlimited =
    PREMIUM_TIERS.has(subscription?.planTier ?? "") && subscription?.planStatus === "active";

  if (!isUnlimited) {
    throw new HttpsError("permission-denied", "Wiki LLM requires an active unlimited subscription.");
  }

  const generateText = options.generateText ?? getTextGenerator();
  let text: string;
  try {
    text = await generateText(systemPrompt, userPrompt);
  } catch (error) {
    logger.error("wikiLlm model call failed", {userId: user.id, error});
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", "Failed to generate wiki response.");
  }

  if (!text) {
    throw new HttpsError("internal", "Model returned an empty response.");
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
