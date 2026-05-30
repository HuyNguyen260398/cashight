export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

import { parseTPBankStatement } from '@/lib/parsers/tpbank';
import { saveStatement } from '@/lib/storage';

export async function POST(request: Request) {
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

  let statement: Awaited<ReturnType<typeof parseTPBankStatement>>;
  try {
    statement = await parseTPBankStatement(buffer);
  } catch (err) {
    console.error('Parse failed:', err instanceof Error ? err.message : err);
    return Response.json(
      { error: 'Could not parse PDF. Make sure it is a TPBank statement.' },
      { status: 422 },
    );
  }

  try {
    const key = await saveStatement(statement);
    return Response.json({ ...statement, _storageKey: key });
  } catch (err) {
    const e = err as { name?: string; message?: string };
    console.error('Save failed:', e.name, '-', e.message);
    // Surface the error name (not the raw message) to the client to ease debugging.
    return Response.json(
      { error: 'Failed to save statement', detail: e.name ?? 'UnknownError' },
      { status: 500 },
    );
  }
}
