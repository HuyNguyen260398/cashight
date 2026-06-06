import { redirect } from 'next/navigation';

import { auth } from '@/auth';

/**
 * Auth boundary for the app. We do NOT rely on `proxy.ts` (Next 16's renamed
 * middleware) for this: Amplify Hosting's Next.js SSR adapter discovers
 * middleware via `middleware-manifest.json`, which Next 16 leaves empty (the
 * proxy moved to `functions-config-manifest.json`). The result is that the
 * proxy compiles locally but is silently never deployed/run on Amplify, so the
 * gate must live in server code, "close to the data" — the pattern Next.js
 * recommends regardless. `proxy.ts` stays as a best-effort fast path for
 * environments that do run it.
 */

// Gate on a real authenticated user, not just a truthy `auth()` result: a
// misconfiguration (e.g. UntrustedHost) makes Auth.js v5 return a truthy error
// object rather than null, and `if (!session)` would let it through (fail-open).
// Requiring `session.user` fails closed instead.

/** Page guard: redirect unauthenticated requests to /signin. Returns the session. */
export async function requireSession() {
  const session = await auth();
  if (!session?.user) redirect('/signin');
  return session;
}

/**
 * Route-handler guard: returns a 401 `Response` when unauthenticated, otherwise
 * `null`. Call at the top of a handler: `const u = await requireApiSession(); if (u) return u;`
 * API callers get a clean JSON 401 instead of an HTML redirect.
 */
export async function requireApiSession(): Promise<Response | null> {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}
