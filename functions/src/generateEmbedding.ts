import {onCall, HttpsError, CallableRequest} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";

const DEFAULT_REGION = "us-central1";
const MODEL_ID = "text-embedding-004";
const MAX_TEXT_LENGTH = 8_000;
const ALLOWED_TASK_TYPES = new Set([
  "RETRIEVAL_DOCUMENT",
  "RETRIEVAL_QUERY",
  "SEMANTIC_SIMILARITY",
]);

export interface GenerateEmbeddingRequest {
  text: string;
  taskType?: string;
}

export interface GenerateEmbeddingResponse {
  embedding: number[];
}

interface EmbeddingOptions {
  embedder?: (text: string, taskType: string) => Promise<number[]>;
}

async function defaultEmbedder(text: string, taskType: string): Promise<number[]> {
  const project = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT;
  if (!project) {
    throw new HttpsError("failed-precondition", "Missing GCLOUD_PROJECT for Vertex AI.");
  }

  const credential = admin.credential.applicationDefault();
  const token = await credential.getAccessToken();

  const endpoint = `https://${DEFAULT_REGION}-aiplatform.googleapis.com/v1/projects/${project}/locations/${DEFAULT_REGION}/publishers/google/models/${MODEL_ID}:predict`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      instances: [{ content: text, task_type: taskType }],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error("Vertex AI embedding error", { status: response.status, body: errorText });
    throw new HttpsError("internal", "Failed to generate embedding.");
  }

  const data = await response.json() as { predictions: [{ embeddings: { values: number[] } }] };
  return data.predictions[0].embeddings.values;
}

export const generateEmbeddingHandler = async (
  request: CallableRequest,
  options: EmbeddingOptions = {},
): Promise<GenerateEmbeddingResponse> => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const data = request.data as Record<string, unknown>;
  const text = data.text;
  const rawTaskType = data.taskType;

  if (typeof text !== "string" || text.trim().length === 0) {
    throw new HttpsError("invalid-argument", "text must be a non-empty string.");
  }
  if (text.trim().length > MAX_TEXT_LENGTH) {
    throw new HttpsError("invalid-argument", `text must be at most ${MAX_TEXT_LENGTH} characters.`);
  }

  const taskType =
    rawTaskType === undefined || rawTaskType === null
      ? "RETRIEVAL_DOCUMENT"
      : String(rawTaskType);

  if (!ALLOWED_TASK_TYPES.has(taskType)) {
    throw new HttpsError(
      "invalid-argument",
      `taskType must be one of: ${[...ALLOWED_TASK_TYPES].join(", ")}.`
    );
  }

  const embedder = options.embedder ?? defaultEmbedder;
  let embedding: number[];
  try {
    embedding = await embedder(text.trim(), taskType);
  } catch (error) {
    logger.error("generateEmbedding: embedder failed", { error });
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", "Failed to generate embedding.");
  }

  return { embedding };
};

export const generateEmbedding = onCall(
  {
    region: DEFAULT_REGION,
    enforceAppCheck: true,
    invoker: "public",
    memory: "256MiB",
  },
  (request) => generateEmbeddingHandler(request),
);
