import { getOidcManager } from '../auth/oidc';
import { getPublicConfig } from '../auth/config';

/**
 * Thrown for any non-2xx response from the API (including 401).
 */
export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(`API request failed with status ${status}`);
    this.name = 'ApiRequestError';
  }
}

/**
 * Return true when `url` is on the same origin as NEXT_PUBLIC_API_BASE_URL.
 * Tokens should only be forwarded to the API — never to third-party origins.
 */
function isApiOrigin(url: string): boolean {
  try {
    const { apiBaseUrl } = getPublicConfig();
    return new URL(url).origin === new URL(apiBaseUrl).origin;
  } catch {
    return false;
  }
}

/** Return the current access token, or null if none / expired. */
async function getAccessToken(): Promise<string | null> {
  try {
    const manager = getOidcManager();
    const user = await manager.getUser();
    if (!user || user.expired) return null;
    return user.access_token;
  } catch {
    return null;
  }
}

/** Remove the local session and send the browser to /signin. */
async function clearSessionAndRedirect(): Promise<void> {
  try {
    const manager = getOidcManager();
    await manager.removeUser();
  } catch {
    // ignore — we always redirect
  }
  window.location.href = '/signin/';
}

/**
 * Fetch wrapper that:
 * - Attaches `Authorization: Bearer <token>` only for requests to the API origin.
 * - Intercepts 401 responses by clearing the session and redirecting to /signin.
 * - Throws `ApiRequestError` for all non-2xx responses.
 * - Returns the raw `Response` on success (supports streaming).
 */
export async function apiFetch(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);

  if (isApiOrigin(url)) {
    const token = await getAccessToken();
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
  }

  const response = await fetch(url, { ...init, headers });

  if (response.status === 401) {
    await clearSessionAndRedirect();
    throw new ApiRequestError(401, null);
  }

  if (!response.ok) {
    let body: unknown;
    try {
      body = await response.clone().json();
    } catch {
      body = await response.text();
    }
    throw new ApiRequestError(response.status, body);
  }

  return response;
}
