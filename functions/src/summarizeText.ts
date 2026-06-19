import {onCall, HttpsError, CallableRequest} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import type {DecodedIdToken} from "firebase-admin/auth";
import { GoogleGenAI } from "@google/genai";

const DEFAULT_MODEL = "gemini-3.5-flash";
const DEFAULT_REGION = "us-central1";
// Gemini 3 family is global-only on Vertex AI; DEFAULT_REGION above still
// governs this Cloud Function's own deploy region, unrelated to this.
const GEMINI_LOCATION = "global";
const MAX_INPUT_LENGTH = 16_000;
const MAX_OUTPUT_TOKENS = 1_024;

interface SummarizeTextData {
  text: string;
  maxCharacters: number;
}

export interface SummarizeTextResponse {
  summary: string;
}

type GenerateSummaryFn = (prompt: string) => Promise<string>;

interface SummarizeTextOptions {
  generateSummary?: GenerateSummaryFn;
}

function getProjectId(): string | undefined {
  const fromEnv = process.env.GCLOUD_PROJECT ?? process.env.GCP_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT;
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

let genAIClient: GoogleGenAI | undefined;
let summaryGenerator: GenerateSummaryFn | undefined;

function getGenAIClient(): GoogleGenAI {
  if (genAIClient) {
    return genAIClient;
  }

  const project = getProjectId();
  if (!project) {
    throw new HttpsError(
      "failed-precondition",
      "Missing GCLOUD_PROJECT for text summarization."
    );
  }

  genAIClient = new GoogleGenAI({ vertexai: true, project, location: GEMINI_LOCATION });
  return genAIClient;
}

function getSummaryGenerator(): GenerateSummaryFn {
  if (summaryGenerator) {
    return summaryGenerator;
  }

  summaryGenerator = async (prompt: string): Promise<string> => {
    const ai = getGenAIClient();
    const result = await ai.models.generateContent({
      model: DEFAULT_MODEL,
      contents: prompt,
      config: {
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });
    const candidates = result.candidates ?? [];

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

    throw new HttpsError("internal", "Model returned an empty summary response.");
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
