import { requireApiSession } from '@/lib/require-session';
import { redactForLog } from '@/lib/security/logging';
import { assertSameOrigin } from '@/lib/security/origin';
import { getStatement, deleteStatement } from '@/lib/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireApiSession();
  if (unauthorized) return unauthorized;

  const { id } = await params;
  let key: string;
  try {
    key = decodeURIComponent(id);
  } catch {
    return Response.json({ error: 'Invalid key' }, { status: 400 });
  }
  if (!key.startsWith('statements/')) {
    return Response.json({ error: 'Invalid key' }, { status: 400 });
  }
  try {
    return Response.json(await getStatement(key));
  } catch (err) {
    if ((err as { name?: string }).name === 'NoSuchKey') {
      return Response.json({ error: 'Not found' }, { status: 404 });
    }
    console.error('Get statement failed:', redactForLog(err instanceof Error ? err.message : err));
    return Response.json({ error: 'Failed to fetch statement' }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireApiSession();
  if (unauthorized) return unauthorized;

  const invalidOrigin = assertSameOrigin(req);
  if (invalidOrigin) return invalidOrigin;

  const { id } = await params;
  let key: string;
  try {
    key = decodeURIComponent(id);
  } catch {
    return Response.json({ error: 'Invalid key' }, { status: 400 });
  }
  if (!key.startsWith('statements/')) {
    return Response.json({ error: 'Invalid key' }, { status: 400 });
  }
  try {
    await deleteStatement(key);
    return new Response(null, { status: 204 });
  } catch (err) {
    console.error('Delete failed:', redactForLog(err instanceof Error ? err.message : err));
    return Response.json({ error: 'Failed to delete statement' }, { status: 500 });
  }
}
