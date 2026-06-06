export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

import { parseTPBankStatement } from '@/lib/parsers/tpbank';
import { requireApiSession } from '@/lib/require-session';
import {
  saveStatement,
  statementExists,
  statementKey,
  isAuthError,
  STORAGE_AUTH_HINT,
} from '@/lib/storage';

export async function POST(request: Request) {
  const unauthorized = await requireApiSession();
  if (unauthorized) return unauthorized;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ error: 'No file provided' }, { status: 400 });
  }

  const file = formData.get('file');

  if (!(file instanceof File)) {
    return Response.json({ error: 'No file provided' }, { status: 400 });
  }

  if (file.type !== 'application/pdf') {
    return Response.json({ error: 'Only PDF files are accepted.' }, { status: 415 });
  }

  if (file.size > 5 * 1024 * 1024) {
    return Response.json({ error: 'File is too large (max 5 MB).' }, { status: 413 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  const pdfPassword = process.env.PDF_PASSWORD;

  let statement: Awaited<ReturnType<typeof parseTPBankStatement>>;
  try {
    statement = await parseTPBankStatement(buffer, pdfPassword);
  } catch (err) {
    if (err instanceof Error && err.name === 'PasswordException') {
      // Log only whether a password was configured — never the password itself
      // nor the raw exception message (which can echo the attempted input).
      const reason = pdfPassword ? 'wrong password' : 'no PDF_PASSWORD configured';
      console.error(`Parse failed: PasswordException — ${reason}`);
      return Response.json(
        { error: 'This PDF is password-protected and the stored password did not unlock it.' },
        { status: 422 },
      );
    }
    console.error('Parse failed:', err instanceof Error ? err.message : err);
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
        return Response.json(
          { error: 'conflict', cardLast4: statement.cardLast4, year, month, key },
          { status: 409 },
        );
      }
    } catch (err) {
      // A flaky existence check should not block the upload; the save below has
      // its own error handling for real storage failures.
      console.error('statementExists check failed:', err instanceof Error ? err.message : err);
    }
  }

  try {
    await saveStatement(statement);
    return Response.json({ ...statement, _storageKey: key });
  } catch (err) {
    const e = err as { name?: string; message?: string };
    console.error('Save failed:', e.name, '-', e.message);
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
}
