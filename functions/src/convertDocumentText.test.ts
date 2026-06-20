import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HttpsError } from 'firebase-functions/v2/https';

process.env.NODE_ENV = 'test';

const { convertDocumentTextHandler } = await import('./convertDocumentText.js');

function makeRequest(data: unknown, uid = 'uid-1') {
  return {
    auth: { uid, token: { uid, email: 'test@example.com', name: 'Test User' } },
    data,
    rawRequest: {},
  } as never;
}

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const VALID_BASE64 = Buffer.from('hello world').toString('base64');

function makeDeps(options: {
  spendCreditsImpl?: (userId: string, amount: number) => Promise<string | null>;
  refundCreditImpl?: (userId: string, transactionId: string, amount: number) => Promise<void>;
  convertDocxImpl?: (buffer: Buffer) => Promise<string>;
  generateFromGeminiImpl?: (mimeType: string, base64: string) => Promise<string>;
} = {}) {
  return {
    userRepository: {
      getOrCreateUserByFirebaseIdentity: async () => ({
        id: 'user-1',
        firebaseUid: 'firebase-uid-1',
        email: 'test@example.com',
        displayName: 'Test User',
        avatarUrl: null,
        isProfilePublic: false,
        defaultCharacterId: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
    },
    creditService: {
      spendCredits: options.spendCreditsImpl ?? (async () => 'mock-tx-id'),
      refundCredit: options.refundCreditImpl ?? (async () => {}),
    },
    convertDocx: options.convertDocxImpl ?? (async () => 'Converted docx text.'),
    generateFromGemini: options.generateFromGeminiImpl ?? (async () => 'Converted gemini text.'),
  };
}

describe('convertDocumentTextHandler', () => {
  it('rejects unauthenticated requests', async () => {
    await assert.rejects(
      () => convertDocumentTextHandler({ auth: null, data: {}, rawRequest: {} } as never, makeDeps() as never),
      (e: unknown) => e instanceof HttpsError && e.code === 'unauthenticated',
    );
  });

  it('rejects token UID mismatch', async () => {
    await assert.rejects(
      () =>
        convertDocumentTextHandler(
          {
            auth: { uid: 'uid-1', token: { uid: 'other-uid', email: 'test@example.com' } },
            data: { filename: 'f.pdf', mimeType: 'application/pdf', contentBase64: VALID_BASE64 },
            rawRequest: {},
          } as never,
          makeDeps() as never,
        ),
      (e: unknown) => e instanceof HttpsError && e.code === 'unauthenticated',
    );
  });

  it('accepts missing token email by falling back to empty string', async () => {
    const result = await convertDocumentTextHandler(
      {
        auth: { uid: 'uid-1', token: { uid: 'uid-1' } } as never,
        data: { filename: 'f.pdf', mimeType: 'application/pdf', contentBase64: VALID_BASE64 },
        rawRequest: {},
      } as never,
      makeDeps() as never,
    );
    assert.ok(typeof result.text === 'string');
  });

  it('rejects missing filename', async () => {
    await assert.rejects(
      () =>
        convertDocumentTextHandler(
          makeRequest({ mimeType: DOCX_MIME, contentBase64: VALID_BASE64 }),
          makeDeps() as never,
        ),
      (e: unknown) => e instanceof HttpsError && e.code === 'invalid-argument',
    );
  });

  it('rejects unsupported mime type', async () => {
    await assert.rejects(
      () =>
        convertDocumentTextHandler(
          makeRequest({ filename: 'f.csv', mimeType: 'text/csv', contentBase64: VALID_BASE64 }),
          makeDeps() as never,
        ),
      (e: unknown) => e instanceof HttpsError && e.code === 'invalid-argument',
    );
  });

  it('rejects contentBase64 exceeding size cap', async () => {
    const oversize = 'A'.repeat(12_000_001);
    await assert.rejects(
      () =>
        convertDocumentTextHandler(
          makeRequest({ filename: 'f.docx', mimeType: DOCX_MIME, contentBase64: oversize }),
          makeDeps() as never,
        ),
      (e: unknown) => e instanceof HttpsError && e.code === 'invalid-argument',
    );
  });

  it('rejects malformed base64', async () => {
    await assert.rejects(
      () =>
        convertDocumentTextHandler(
          makeRequest({ filename: 'f.docx', mimeType: DOCX_MIME, contentBase64: 'not base64!!' }),
          makeDeps() as never,
        ),
      (e: unknown) => e instanceof HttpsError && e.code === 'invalid-argument',
    );
  });

  it('does not charge credits when validation fails', async () => {
    let spendCalled = false;
    const deps = makeDeps({
      spendCreditsImpl: async () => {
        spendCalled = true;
        return 'tx';
      },
    });
    await assert.rejects(() =>
      convertDocumentTextHandler(
        makeRequest({ filename: 'f.csv', mimeType: 'text/csv', contentBase64: VALID_BASE64 }),
        deps as never,
      ),
    );
    assert.equal(spendCalled, false);
  });

  it('rejects when credits are insufficient', async () => {
    const deps = makeDeps({ spendCreditsImpl: async () => null });
    await assert.rejects(
      () =>
        convertDocumentTextHandler(
          makeRequest({ filename: 'f.docx', mimeType: DOCX_MIME, contentBase64: VALID_BASE64 }),
          deps as never,
        ),
      (e: unknown) => e instanceof HttpsError && e.code === 'failed-precondition',
    );
  });

  it('converts DOCX via mammoth and returns text', async () => {
    const deps = makeDeps({ convertDocxImpl: async () => 'Extracted docx paragraph text.' });
    const result = await convertDocumentTextHandler(
      makeRequest({ filename: 'f.docx', mimeType: DOCX_MIME, contentBase64: VALID_BASE64 }),
      deps as never,
    );
    assert.equal(result.text, 'Extracted docx paragraph text.');
    assert.equal(result.truncated, false);
  });

  it('accepts mime types with incidental whitespace and casing', async () => {
    const deps = makeDeps({ generateFromGeminiImpl: async () => 'Normalized mime text.' });
    const result = await convertDocumentTextHandler(
      makeRequest({ filename: 'f.pdf', mimeType: ' Application/PDF ', contentBase64: VALID_BASE64 }),
      deps as never,
    );
    assert.equal(result.text, 'Normalized mime text.');
  });

  it('converts PDF via Gemini and returns text', async () => {
    let capturedMime = '';
    const deps = makeDeps({
      generateFromGeminiImpl: async (mimeType: string) => {
        capturedMime = mimeType;
        return '# Transcribed markdown';
      },
    });
    const result = await convertDocumentTextHandler(
      makeRequest({ filename: 'f.pdf', mimeType: 'application/pdf', contentBase64: VALID_BASE64 }),
      deps as never,
    );
    assert.equal(result.text, '# Transcribed markdown');
    assert.equal(capturedMime, 'application/pdf');
  });

  it('converts image via Gemini and returns text', async () => {
    const deps = makeDeps({ generateFromGeminiImpl: async () => 'Transcribed image text.' });
    const result = await convertDocumentTextHandler(
      makeRequest({ filename: 'f.png', mimeType: 'image/png', contentBase64: VALID_BASE64 }),
      deps as never,
    );
    assert.equal(result.text, 'Transcribed image text.');
  });

  it('refunds credit when mammoth conversion throws', async () => {
    let refunded = false;
    const deps = makeDeps({
      convertDocxImpl: async () => {
        throw new HttpsError('invalid-argument', 'Could not read DOCX file.');
      },
      refundCreditImpl: async () => {
        refunded = true;
      },
    });
    await assert.rejects(() =>
      convertDocumentTextHandler(
        makeRequest({ filename: 'f.docx', mimeType: DOCX_MIME, contentBase64: VALID_BASE64 }),
        deps as never,
      ),
    );
    assert.equal(refunded, true);
  });

  it('refunds credit when Gemini conversion throws', async () => {
    let refunded = false;
    const deps = makeDeps({
      generateFromGeminiImpl: async () => {
        throw new Error('Vertex AI unavailable');
      },
      refundCreditImpl: async () => {
        refunded = true;
      },
    });
    await assert.rejects(
      () =>
        convertDocumentTextHandler(
          makeRequest({ filename: 'f.pdf', mimeType: 'application/pdf', contentBase64: VALID_BASE64 }),
          deps as never,
        ),
      (e: unknown) => e instanceof HttpsError && e.code === 'internal',
    );
    assert.equal(refunded, true);
  });

  it('refunds credit and rejects when conversion produces empty text', async () => {
    let refunded = false;
    const deps = makeDeps({
      generateFromGeminiImpl: async () => '   ',
      refundCreditImpl: async () => {
        refunded = true;
      },
    });
    await assert.rejects(
      () =>
        convertDocumentTextHandler(
          makeRequest({ filename: 'f.pdf', mimeType: 'application/pdf', contentBase64: VALID_BASE64 }),
          deps as never,
        ),
      (e: unknown) => e instanceof HttpsError && e.code === 'internal',
    );
    assert.equal(refunded, true);
  });

  it('truncates output exceeding MAX_DOCUMENT_CHARS and sets truncated flag', async () => {
    const longText = 'a'.repeat(200_001);
    const deps = makeDeps({ generateFromGeminiImpl: async () => longText });
    const result = await convertDocumentTextHandler(
      makeRequest({ filename: 'f.pdf', mimeType: 'application/pdf', contentBase64: VALID_BASE64 }),
      deps as never,
    );
    assert.equal(result.text.length, 200_000);
    assert.equal(result.truncated, true);
  });

  it('sanitizes filename without throwing', async () => {
    const result = await convertDocumentTextHandler(
      makeRequest({ filename: '../../../etc/passwd.docx', mimeType: DOCX_MIME, contentBase64: VALID_BASE64 }),
      makeDeps() as never,
    );
    assert.ok(result.text.length > 0);
  });
});
