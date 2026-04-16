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

const APP_NAME = "clanker";
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

interface SubscriptionRow {
  plan_tier: string;
  current_credits: number | null;
}

interface UsageState {
  planTier: string | null;
  hasUnlimited: boolean;
  creditBalance: number;
}

export interface GenerateReplyResponse {
  reply: string;
  creditsSpent: number;
  remainingCredits: number | null;
  planTier: string | null;
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
    logger.error("Failed to load subscription state", {supabaseUserId, error});
    throw new HttpsError("internal", "Failed to verify subscription access.");
  }

  if (!data || data.length === 0) {
    logger.info("No active subscription rows for Supabase user", {supabaseUserId});
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
    p_description: "chat response",
    p_reference_id: referenceId,
  }) as {remaining_credits?: number};

  if (typeof spendResult?.remaining_credits === "number") {
    return spendResult.remaining_credits;
  }

  logger.error("spend_user_credits returned invalid payload", {
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

  try {
    return await spendOneCredit(supabaseUserId, referenceId);
  } catch (error) {
    logger.error("Failed to spend credit after successful chat generation", {
      supabaseUserId,
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

  const generateText = options.generateText ?? getTextGenerator();

  let reply: string;
  try {
    reply = (await generateText(prompt)).trim();
  } catch (error) {
    logger.error("generateReply model call failed", {
      supabaseUserId: supabaseUser.id,
      error,
    });
    throw new HttpsError("internal", "Failed to generate chat response.");
  }

  if (!reply) {
    throw new HttpsError("internal", "Model returned an empty chat response.");
  }

  const remainingCredits = await spendOneCreditIfRequired(supabaseUser.id, usage, referenceId);

  return {
    reply,
    creditsSpent: usage.hasUnlimited ? 0 : 1,
    remainingCredits,
    planTier: usage.planTier,
  };
};

export const generateReplyHandler = handler;

export const generateReply = onCall(
  {
    region: DEFAULT_REGION,
    enforceAppCheck: true,
    invoker: "public",
    secrets: ["SUPABASE_SERVICE_ROLE_KEY"],
  },
  (request) => handler(request)
);
