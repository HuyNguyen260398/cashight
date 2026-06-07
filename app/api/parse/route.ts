export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

import { parseTPBankStatement } from '@/lib/parsers/tpbank';
import { requireApiSessionWithUser } from '@/lib/require-session';
import { getPdfPassword } from '@/lib/server-secrets';
import { redactForLog } from '@/lib/security/logging';
import { assertSameOrigin } from '@/lib/security/origin';
import { checkRateLimit } from '@/lib/security/rate-limit';
import { validatePdfUpload } from '@/lib/security/upload';
import {
  saveStatement,
  statementExists,
  statementKey,
  isAuthError,
  STORAGE_AUTH_HINT,
} from '@/lib/storage';

/**
 * Diagnostic logger for the upload path. Prefixed + tagged with a short request
 * id so a single upload's lifecycle is greppable in CloudWatch (the Amplify SSR
 * log group). PCI: only ever pass non-sensitive values here — cardLast4, counts,
 * totals, storage keys. Never raw descriptions, names, the full PAN, or the file.
 */
function logStage(reqId: string, stage: string, extra?: Record<string, unknown>) {
  const suffix = extra ? ` ${JSON.stringify(redactForLog(extra))}` : '';
  console.info(`[parse ${reqId}] ${stage}${suffix}`);
}

/** Serialize an error for logs: name, message, and stack (no PII in our errors). */
function describeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  return { value: String(err) };
}

export async function POST(request: Request) {
  const reqId = Math.random().toString(36).slice(2, 8);
  const startedAt = Date.now();
  const elapsed = () => `${Date.now() - startedAt}ms`;

  // One-time environment snapshot (booleans only — never values) so a deploy
  // with a missing env var is obvious in the logs instead of a cryptic crash.
  logStage(reqId, 'request received', {
    runtime: process.version,
    env: {
      STATEMENTS_BUCKET: Boolean(process.env.STATEMENTS_BUCKET),
      STORAGE_REGION: Boolean(process.env.STORAGE_REGION),
      AWS_REGION: Boolean(process.env.AWS_REGION),
      PDF_PASSWORD: Boolean(process.env.PDF_PASSWORD),
      PDF_PASSWORD_PARAMETER: Boolean(process.env.PDF_PASSWORD_PARAMETER),
    },
  });

  // Top-level guard: anything that escapes the inner handlers below (a module
  // failing to initialize, pdf-parse crashing, an auth() throw, a timeout-
  // adjacent error) would otherwise surface as a generic, non-JSON 500 from the
  // Amplify runtime — exactly the opaque "Upload failed (500)" we're chasing.
  // Catch it, log the full error, and return JSON so the cause is visible both
  // in CloudWatch and to the client.
  try {
    const authResult = await requireApiSessionWithUser();
    if ('response' in authResult) {
      logStage(reqId, 'unauthorized', { elapsed: elapsed() });
      return authResult.response;
    }
    const { session } = authResult;

    const invalidOrigin = assertSameOrigin(request);
    if (invalidOrigin) return invalidOrigin;

    const rateLimitKey = session.user.email ?? session.user.name ?? 'unknown-user';
    const rateLimited = checkRateLimit(`parse:${rateLimitKey}`, {
      limit: 5,
      windowMs: 10 * 60 * 1000,
    });
    if (rateLimited) return rateLimited;

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      logStage(reqId, 'formData parse failed', { elapsed: elapsed() });
      return Response.json({ error: 'No file provided' }, { status: 400 });
    }

    const file = formData.get('file');

    if (!(file instanceof File)) {
      logStage(reqId, 'no file in form data', { elapsed: elapsed() });
      return Response.json({ error: 'No file provided' }, { status: 400 });
    }

    logStage(reqId, 'file received', { type: file.type, size: file.size });

    const upload = await validatePdfUpload(file);
    if ('response' in upload) return upload.response;

    const { buffer } = upload;
    logStage(reqId, 'buffer ready', { bytes: buffer.length, elapsed: elapsed() });

    const pdfPassword = await getPdfPassword();

    let statement: Awaited<ReturnType<typeof parseTPBankStatement>>;
    try {
      logStage(reqId, 'parse start');
      statement = await parseTPBankStatement(buffer, pdfPassword);
      logStage(reqId, 'parse ok', {
        cardLast4: statement.cardLast4,
        statementDate: statement.statementDate,
        transactions: statement.transactions.length,
        elapsed: elapsed(),
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'PasswordException') {
        // Log only whether a password was configured — never the password itself
        // nor the raw exception message (which can echo the attempted input).
        const reason = pdfPassword ? 'wrong password' : 'no PDF_PASSWORD configured';
        console.error(`[parse ${reqId}] parse failed: PasswordException — ${reason}`);
        return Response.json(
          { error: 'This PDF is password-protected and the stored password did not unlock it.' },
        { status: 422 },
      );
    }
      console.error(`[parse ${reqId}] parse failed`, redactForLog(describeError(err)));
      return Response.json(
        { error: 'Could not parse PDF. Make sure it is a TPBank statement.' },
        { status: 422 },
      );
    }

    const force = new URL(request.url).searchParams.get('force') === 'true';
    const [year, month] = statement.statementDate.split('-').map(Number);
    const key = statementKey(statement.cardLast4, year, month);

    if (!force) {
      try {
        if (await statementExists(key)) {
          logStage(reqId, 'conflict — statement exists', { key, elapsed: elapsed() });
          return Response.json(
            { error: 'conflict', cardLast4: statement.cardLast4, year, month, key },
            { status: 409 },
          );
        }
        logStage(reqId, 'exists check ok — no conflict', { key });
      } catch (err) {
        // A flaky existence check should not block the upload; the save below has
        // its own error handling for real storage failures.
        console.error(
          `[parse ${reqId}] statementExists check failed`,
          redactForLog(describeError(err)),
        );
      }
    }

    try {
      logStage(reqId, 'save start', { key });
      await saveStatement(statement);
      logStage(reqId, 'save ok', { key, elapsed: elapsed() });
      return Response.json({ ...statement, _storageKey: key });
    } catch (err) {
      console.error(`[parse ${reqId}] save failed`, redactForLog(describeError(err)));
      const e = err as { name?: string; message?: string };
      // A credentials/auth failure is environmental, not a bug — return an
      // actionable message and 503 (storage dependency unavailable) instead of a
      // generic 500 "Failed to save statement" that hides the real cause.
      if (isAuthError(err)) {
        return Response.json(
          { error: STORAGE_AUTH_HINT, detail: e.name ?? 'AuthError' },
          { status: 503 },
        );
      }
      // Surface the error name (not the raw message) to the client to ease debugging.
      return Response.json(
        { error: 'Failed to save statement', detail: e.name ?? 'UnknownError' },
        { status: 500 },
      );
    }
  } catch (err) {
    // The opaque-500 catch-all. Reaching here means an error escaped every inner
    // handler — log it loudly and still answer with JSON so the client shows a
    // real message instead of the bare "Upload failed (500)".
    console.error(`[parse ${reqId}] UNCAUGHT in upload handler`, redactForLog({
      elapsed: elapsed(),
      ...describeError(err),
    }));
    const e = err as { name?: string };
    return Response.json(
      { error: 'Unexpected server error while processing the upload.', detail: e.name ?? 'UnknownError' },
      { status: 500 },
    );
  }
}
