// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiFetch, ApiRequestError } from '../api/client';

// ── mocks ──────────────────────────────────────────────────────────────────

const mockGetUser = vi.fn();
const mockRemoveUser = vi.fn();

const mockManager = {
  getUser: mockGetUser,
  removeUser: mockRemoveUser,
};

vi.mock('../auth/oidc', () => ({
  getOidcManager: () => mockManager,
}));

vi.mock('../auth/config', () => ({
  getPublicConfig: () => ({
    apiBaseUrl: 'https://api.example.com',
    cognitoAuthority: 'https://cognito.example.com',
    cognitoClientId: 'test-client-id',
    appOrigin: 'https://app.example.com',
  }),
}));

// ── helpers ─────────────────────────────────────────────────────────────────

function makeUser(
  overrides?: Partial<{ expired: boolean; access_token: string }>,
) {
  return {
    expired: false,
    access_token: 'test-access-token',
    profile: { email: 'user@test.com', sub: 'sub-123' },
    ...overrides,
  };
}

// ── tests ───────────────────────────────────────────────────────────────────

describe('apiFetch', () => {
  const mockFetch = vi.fn();
  let originalFetch: typeof global.fetch;
  let originalLocation: Location;

  beforeEach(() => {
    vi.clearAllMocks();

    originalFetch = global.fetch;
    global.fetch = mockFetch;

    // Replace window.location with a writable stub so we can observe
    // window.location.href assignments without triggering jsdom navigation.
    originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: { href: '' },
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: originalLocation,
    });
  });

  it('attaches Bearer token when request URL matches the API origin', async () => {
    mockGetUser.mockResolvedValue(makeUser());
    mockFetch.mockResolvedValue(new Response('{}', { status: 200 }));

    await apiFetch('https://api.example.com/uploads');

    expect(mockFetch).toHaveBeenCalledOnce();
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const authHeader = (init.headers as Headers).get('Authorization');
    expect(authHeader).toBe('Bearer test-access-token');
  });

  it('does not attach token when request URL origin differs from API origin', async () => {
    mockGetUser.mockResolvedValue(makeUser());
    mockFetch.mockResolvedValue(new Response('{}', { status: 200 }));

    await apiFetch('https://other.example.com/resource');

    expect(mockFetch).toHaveBeenCalledOnce();
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const authHeader = (init.headers as Headers).get('Authorization');
    expect(authHeader).toBeNull();
  });

  it('does not attach token for an expired user session', async () => {
    mockGetUser.mockResolvedValue(makeUser({ expired: true }));
    mockFetch.mockResolvedValue(new Response('{}', { status: 200 }));

    await apiFetch('https://api.example.com/uploads');

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const authHeader = (init.headers as Headers).get('Authorization');
    expect(authHeader).toBeNull();
  });

  it('clears session and redirects to /signin on a 401 response', async () => {
    mockGetUser.mockResolvedValue(makeUser());
    mockRemoveUser.mockResolvedValue(undefined);
    mockFetch.mockResolvedValue(new Response('Unauthorized', { status: 401 }));

    await expect(apiFetch('https://api.example.com/uploads')).rejects.toBeInstanceOf(
      ApiRequestError,
    );

    expect(mockRemoveUser).toHaveBeenCalledOnce();
    expect((window.location as { href: string }).href).toBe('/signin');
  });

  it('throws ApiRequestError for non-401 error responses', async () => {
    mockGetUser.mockResolvedValue(makeUser());
    mockFetch.mockResolvedValue(
      new Response('{"error":{"code":"NOT_FOUND","message":"Not found."}}', {
        status: 404,
      }),
    );

    const err = await apiFetch('https://api.example.com/uploads/missing').catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiRequestError);
    expect((err as ApiRequestError).status).toBe(404);
  });

  it('returns the Response on a successful request', async () => {
    mockGetUser.mockResolvedValue(makeUser());
    const mockResponse = new Response('{"ok":true}', { status: 200 });
    mockFetch.mockResolvedValue(mockResponse);

    const response = await apiFetch('https://api.example.com/uploads');
    expect(response.status).toBe(200);
  });
});
