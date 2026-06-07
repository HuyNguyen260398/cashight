function hostFromUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return null;
  }
}

function normalizeHost(value: string | undefined | null): string | null {
  if (!value) return null;
  const host = value.split(',')[0]?.trim().toLowerCase();
  return host || null;
}

function allowedHosts(request: Request): Set<string> {
  const hosts = new Set<string>();
  const add = (host: string | null) => {
    if (host) hosts.add(host);
  };

  add(normalizeHost(request.headers.get('host')));
  add(normalizeHost(request.headers.get('x-forwarded-host')));
  add(hostFromUrl(process.env.AUTH_URL));
  add(hostFromUrl(process.env.APP_ORIGIN));
  add(hostFromUrl(request.url));

  return hosts;
}

export function assertSameOrigin(request: Request): Response | null {
  const origin = request.headers.get('origin');
  if (!origin) return null;

  const originHost = hostFromUrl(origin);
  if (!originHost) {
    return Response.json({ error: 'Invalid request origin' }, { status: 403 });
  }

  if (allowedHosts(request).has(originHost)) return null;

  return Response.json({ error: 'Invalid request origin' }, { status: 403 });
}
