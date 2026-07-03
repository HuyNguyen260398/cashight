// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── mocks ──────────────────────────────────────────────────────────────────

const mockSigninRedirect = vi.fn();
const mockSignoutRedirect = vi.fn();

class MockUserManager {
  signinRedirect = mockSigninRedirect;
  signoutRedirect = mockSignoutRedirect;
  settings: { post_logout_redirect_uri?: string };

  constructor(args: { post_logout_redirect_uri?: string }) {
    this.settings = { post_logout_redirect_uri: args.post_logout_redirect_uri };
  }
}

vi.mock('oidc-client-ts', () => ({
  UserManager: MockUserManager,
  WebStorageStateStore: vi.fn(),
}));

vi.mock('../auth/config', () => ({
  getPublicConfig: () => ({
    apiBaseUrl: 'https://api.example.com',
    cognitoAuthority: 'https://cognito.example.com',
    cognitoClientId: 'test-client-id',
    appOrigin: 'https://app.example.com',
  }),
}));

describe('signOut', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('passes client_id and logout_uri so Cognito accepts the /logout redirect', async () => {
    // Cognito's /logout endpoint ignores the OIDC-standard id_token_hint /
    // post_logout_redirect_uri params that oidc-client-ts sends by default,
    // and instead requires its own client_id + logout_uri pair (logout_uri
    // matched against the app client's Allowed sign-out URLs). Without both
    // forced through explicitly, Cognito 400s at its own /error page.
    const { signOut } = await import('../auth/oidc');
    await signOut();

    expect(mockSignoutRedirect).toHaveBeenCalledWith({
      extraQueryParams: {
        client_id: 'test-client-id',
        logout_uri: 'https://app.example.com/signin/',
      },
    });
  });
});
