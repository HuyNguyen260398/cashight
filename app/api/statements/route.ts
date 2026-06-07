import { requireApiSession } from '@/lib/require-session';
import { redactForLog } from '@/lib/security/logging';
import { listStatements } from '@/lib/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const unauthorized = await requireApiSession();
  if (unauthorized) return unauthorized;

  try {
    const items = await listStatements();
    return Response.json(items);
  } catch (err) {
    console.error('List failed:', redactForLog(err instanceof Error ? err.message : err));
    return Response.json({ error: 'Failed to list statements' }, { status: 500 });
  }
}
