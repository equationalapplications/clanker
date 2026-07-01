import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { GoogleGenAI } from '@google/genai';
import * as mammoth from 'mammoth';

import { CLOUD_SQL_SECRETS } from './cloudSqlSecrets.js';
import { userRepository } from './services/userRepository.js';
import { creditService } from './services/creditService.js';

// ─── Constants ────────────────────────────────────────────────────────────────
const DEFAULT_REGION = 'us-central1';
// Gemini 3 family is global-only on Vertex AI; DEFAULT_REGION above still
// governs this Cloud Function's own deploy region, unrelated to this.
const GEMINI_LOCATION = 'global';
const CONVERT_MODEL = 'gemini-3.5-flash';
const MAX_BASE64_LENGTH = 12_000_000; // ~9MB raw file
const MAX_DOCUMENT_CHARS = 200_000;

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const GEMINI_MIME_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp']);
const ALLOWED_MIME_TYPES = new Set<string>([DOCX_MIME, ...GEMINI_MIME_TYPES]);

const CONVERSION_PROMPT =
  'Transcribe all text content from this document into clean markdown. ' +
  'Preserve headings, lists, and tables where present. ' +
  'Output only the transcribed markdown — no commentary, no preamble.';

// ─── Types ────────────────────────────────────────────────────────────────────
export interface ConvertDocumentTextOutput {
  text: string;
  truncated: boolean;
}

interface ConvertDocumentTextInput {
  filename?: unknown;
  mimeType?: unknown;
  contentBase64?: unknown;
}

interface ConvertDocumentTextDeps {
  userRepository: Pick<typeof userRepository, 'getOrCreateUserByFirebaseIdentity'>;
  creditService: Pick<typeof creditService, 'spendCredits' | 'refundCredit'>;
  convertDocx: (buffer: Buffer) => Promise<string>;
  generateFromGemini: (mimeType: string, base64: string) => Promise<string>;
}

let genAIClient: GoogleGenAI | undefined;

function getProjectId(): string {
  const value = [
    process.env.GCLOUD_PROJECT,
    process.env.GCP_PROJECT,
    process.env.GOOGLE_CLOUD_PROJECT,
  ]
    .map((v) => v?.trim())
    .find((v): v is string => Boolean(v));
  if (!value) {
    throw new HttpsError(
      'failed-precondition',
      'Missing project env (GCLOUD_PROJECT, GCP_PROJECT, or GOOGLE_CLOUD_PROJECT) for document conversion.',
    );
  }
  return value;
}

function getGenAIClient(): GoogleGenAI {
  if (genAIClient) {
    return genAIClient;
  }
  genAIClient = new GoogleGenAI({
    vertexai: true,
    project: getProjectId(),
    location: GEMINI_LOCATION,
  });
  return genAIClient;
}

async function defaultGenerateFromGemini(mimeType: string, base64: string): Promise<string> {
  const ai = getGenAIClient();
  const result = await ai.models.generateContent({
    model: CONVERT_MODEL,
    contents: [
      {
        role: 'user',
        parts: [{ inlineData: { mimeType, data: base64 } }, { text: CONVERSION_PROMPT }],
      },
    ],
    config: { maxOutputTokens: 65_536, thinkingConfig: { thinkingBudget: 0 } },
  });
  const candidates = result.candidates ?? [];
  for (const candidate of candidates) {
    const text = (candidate.content?.parts ?? [])
      .map((p) => (typeof p.text === 'string' ? p.text : ''))
      .join('')
      .trim();
    if (text) return text;
  }
  throw new HttpsError('internal', 'Model returned empty conversion response.');
}

async function defaultConvertDocx(buffer: Buffer): Promise<string> {
  try {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  } catch {
    throw new HttpsError('invalid-argument', 'Could not read DOCX file.');
  }
}

// ─── Input parsing ────────────────────────────────────────────────────────────
function parseInput(data: unknown): {
  filename: string;
  mimeType: string;
  contentBase64: string;
} {
  if (!data || typeof data !== 'object') {
    throw new HttpsError('invalid-argument', 'Valid payload is required.');
  }
  const payload = data as ConvertDocumentTextInput;

  if (typeof payload.filename !== 'string' || !payload.filename.trim()) {
    throw new HttpsError('invalid-argument', 'filename is required.');
  }
  const filename = payload.filename
    .replace(/[^A-Za-z0-9._\- ]/g, '')
    .trim()
    .slice(0, 255);
  if (!filename) {
    throw new HttpsError('invalid-argument', 'filename is required after sanitization.');
  }

  if (typeof payload.mimeType !== 'string') {
    throw new HttpsError('invalid-argument', 'Unsupported file type.');
  }
  const mimeType = payload.mimeType.trim().toLowerCase();
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new HttpsError('invalid-argument', 'Unsupported file type.');
  }

  if (typeof payload.contentBase64 !== 'string' || !payload.contentBase64) {
    throw new HttpsError('invalid-argument', 'contentBase64 must be a non-empty string.');
  }
  if (payload.contentBase64.length > MAX_BASE64_LENGTH) {
    throw new HttpsError('invalid-argument', 'File too large.');
  }
  if (
    !/^[A-Za-z0-9+/]+={0,2}$/.test(payload.contentBase64) ||
    payload.contentBase64.length % 4 !== 0
  ) {
    throw new HttpsError('invalid-argument', 'contentBase64 must be valid base64.');
  }

  return { filename, mimeType, contentBase64: payload.contentBase64 };
}

// ─── Handler ──────────────────────────────────────────────────────────────────
export async function convertDocumentTextHandler(
  request: CallableRequest,
  deps: ConvertDocumentTextDeps = {
    userRepository,
    creditService,
    convertDocx: defaultConvertDocx,
    generateFromGemini: defaultGenerateFromGemini,
  },
): Promise<ConvertDocumentTextOutput> {
  // 1. Auth check
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required.');
  }
  const decoded = request.auth.token as DecodedIdToken;
  if (!decoded || decoded.uid !== request.auth.uid) {
    throw new HttpsError('unauthenticated', 'Invalid Firebase authentication token.');
  }

  // 2. Parse + validate input (before any credit charge)
  const { filename, mimeType, contentBase64 } = parseInput(request.data);

  // 3. User identity
  const user = await deps.userRepository.getOrCreateUserByFirebaseIdentity({
    firebaseUid: request.auth.uid,
    email: typeof decoded.email === 'string' ? decoded.email.trim() : '',
    displayName: decoded.name,
  });

  // 4. Charge 1 credit before conversion; refunded on any failure below.
  const spendAllocations = await deps.creditService.spendCredits(user.id, 1);
  if (!spendAllocations) {
    throw new HttpsError('failed-precondition', 'Insufficient credits to convert document.');
  }

  logger.info('convertDocumentText start', {
    filenameLen: filename.length,
    mimeType,
    base64Len: contentBase64.length,
    userId: user.id,
  });

  try {
    let text: string;
    if (mimeType === DOCX_MIME) {
      const buffer = Buffer.from(contentBase64, 'base64');
      text = await deps.convertDocx(buffer);
    } else {
      text = await deps.generateFromGemini(mimeType, contentBase64);
    }

    if (!text.trim()) {
      throw new HttpsError('internal', 'Conversion produced no text.');
    }

    let truncated = false;
    if (text.length > MAX_DOCUMENT_CHARS) {
      text = text.slice(0, MAX_DOCUMENT_CHARS);
      truncated = true;
    }

    logger.info('convertDocumentText done', {
      mimeType,
      outputLen: text.length,
      truncated,
      userId: user.id,
    });

    return { text, truncated };
  } catch (error) {
    logger.error('convertDocumentText conversion failed', {
      userId: user.id,
      mimeType,
      error,
    });
    try {
      await deps.creditService.refundCredit(user.id, spendAllocations);
      logger.warn('convertDocumentText refunded credit after conversion failure', {
        userId: user.id,
        spendAllocations,
      });
    } catch (refundError) {
      logger.error('convertDocumentText failed to refund credit after failure', {
        userId: user.id,
        spendAllocations,
        error: refundError instanceof Error ? refundError.message : String(refundError),
      });
    }
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError('internal', 'Failed to convert document.');
  }
}

// ─── Export ───────────────────────────────────────────────────────────────────
export const convertDocumentText = onCall(
  {
    region: DEFAULT_REGION,
    timeoutSeconds: 540,
    memory: '512MiB',
    enforceAppCheck: true,
    invoker: 'public',
    secrets: [...CLOUD_SQL_SECRETS],
  },
  (request) => convertDocumentTextHandler(request),
);
