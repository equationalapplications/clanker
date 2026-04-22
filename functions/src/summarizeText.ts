import {onCall, HttpsError, CallableRequest} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import type {DecodedIdToken} from "firebase-admin/auth";

const DEFAULT_MODEL = "gemini-2.5-flash";
const DEFAULT_REGION = "us-central1";
const MAX_INPUT_LENGTH = 16_000;
const MAX_OUTPUT_TOKENS = 1_024;

interface SummarizeTextData {
  text: string;
  maxCharacters: number;
}

export interface SummarizeTextResponse {
  summary: string;
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

type GenerateSummaryFn = (prompt: string) => Promise<string>;

interface SummarizeTextOptions {
  generateSummary?: GenerateSummaryFn;
}

function getProjectId(): string | undefined {
  const fromEnv = process.env.GCLOUD_PROJECT ?? process.env.GCP_PROJECT;
  const value = fromEnv?.trim();
  return value ? value : undefined;
}

function truncateSummary(text: string, maxLength: number): string {
  return text.trim().slice(0, maxLength);
}

function buildPrompt(text: string, maxCharacters: number): string {
  return `Summarize the following chat memory text into at most ${maxCharacters} characters.
Focus on stable facts, user preferences, open threads, and actionable memory.
Prioritize recency when details conflict, keep the output concise, and do not add new facts.

Text:
${text}`;
}

function parseInput(data: unknown): {text: string; maxCharacters: number} {
  const payload = data as SummarizeTextData | undefined;
  const rawText = typeof payload?.text === "string" ? payload.text.trim() : "";
  const rawMaxCharacters = payload?.maxCharacters;

  if (!rawText) {
    throw new HttpsError("invalid-argument", "text must be a non-empty string.");
  }

  if (rawText.length > MAX_INPUT_LENGTH) {
    throw new HttpsError(
      "invalid-argument",
      `text must be at most ${MAX_INPUT_LENGTH} characters.`
    );
  }

  if (
    typeof rawMaxCharacters !== "number" ||
    !Number.isInteger(rawMaxCharacters) ||
    rawMaxCharacters < 1
  ) {
    throw new HttpsError("invalid-argument", "maxCharacters must be a positive integer.");
  }

  const maxCharacters = rawMaxCharacters;

  return {
    text: rawText,
    maxCharacters,
  };
}

let modelPromise: Promise<GenerativeModelLike> | undefined;
let summaryGenerator: GenerateSummaryFn | undefined;

async function getModel(): Promise<GenerativeModelLike> {
  if (modelPromise) {
    return modelPromise;
  }

  const project = getProjectId();
  if (!project) {
    throw new HttpsError(
      "failed-precondition",
      "Missing GCLOUD_PROJECT for Vertex AI text summarization."
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
          maxOutputTokens: MAX_OUTPUT_TOKENS,
        },
      });
    } catch (error: unknown) {
      modelPromise = undefined;

      const message = error instanceof Error ? error.message : String(error);
      const missingVertexModule =
        (error instanceof Error &&
          ("code" in error && (error as NodeJS.ErrnoException).code === "MODULE_NOT_FOUND")) ||
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
        `Failed to initialize summarization model: ${message}`
      );
    }
  })();

  return modelPromise;
}

function getSummaryGenerator(): GenerateSummaryFn {
  if (summaryGenerator) {
    return summaryGenerator;
  }

  summaryGenerator = async (prompt: string): Promise<string> => {
    const model = await getModel();
    const result = await model.generateContent(prompt);
    const candidates = result.response.candidates ?? [];

    for (const candidate of candidates) {
      const parts = candidate.content?.parts ?? [];
      const text = parts
        .map((part) => (typeof part.text === "string" ? part.text : ""))
        .join("")
        .trim();
      if (text) {
        return text;
      }
    }

    throw new HttpsError("internal", "Vertex AI returned an empty summary response.");
  };

  return summaryGenerator;
}

const handler = async (
  request: CallableRequest,
  options: SummarizeTextOptions = {}
): Promise<SummarizeTextResponse> => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const decoded: DecodedIdToken = request.auth.token as DecodedIdToken;
  if (!decoded || decoded.uid !== request.auth.uid) {
    throw new HttpsError("unauthenticated", "Invalid Firebase authentication token.");
  }

  const {text, maxCharacters} = parseInput(request.data);
  const generateSummary = options.generateSummary ?? getSummaryGenerator();

  let summary: string;
  try {
    summary = await generateSummary(buildPrompt(text, maxCharacters));
  } catch (error) {
    logger.error("summarizeText model call failed", {error});
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError("internal", "Failed to summarize text.");
  }

  const normalizedSummary = truncateSummary(summary, maxCharacters);
  if (!normalizedSummary) {
    throw new HttpsError("internal", "Model returned an empty summary.");
  }

  return {summary: normalizedSummary};
};

export const summarizeTextHandler = handler;

export const summarizeText = onCall(
  {
    region: DEFAULT_REGION,
    enforceAppCheck: true,
    invoker: "public",
  },
  (request) => handler(request)
);
