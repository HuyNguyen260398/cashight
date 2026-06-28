// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { AuthProvider, useAuth } from '../auth/auth-provider';
import { ProtectedRoute } from '../auth/protected-route';
import { getOidcManager } from '../auth/oidc';
import CallbackPage from '../../app/auth/callback/page';

// ── mocks ──────────────────────────────────────────────────────────────────

const mockReplace = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  usePathname: () => '/',
}));

const mockGetUser = vi.fn();
const mockSigninSilent = vi.fn();
const mockRemoveUser = vi.fn();
const mockSigninRedirect = vi.fn();
const mockSignoutRedirect = vi.fn();
const mockSigninRedirectCallback = vi.fn();

const mockManager = {
  getUser: mockGetUser,
  signinSilent: mockSigninSilent,
  removeUser: mockRemoveUser,
  signinRedirect: mockSigninRedirect,
  signoutRedirect: mockSignoutRedirect,
  signinRedirectCallback: mockSigninRedirectCallback,
};

vi.mock('../auth/oidc', () => ({
  getOidcManager: () => mockManager,
}));

// ── helpers ─────────────────────────────────────────────────────────────────

function AuthStatus() {
  const { user, loading } = useAuth();
  if (loading) return <span data-testid="status">loading</span>;
  if (!user) return <span data-testid="status">unauthenticated</span>;
  const email = (user.profile as { email?: string }).email ?? '';
  return <span data-testid="status">{`authenticated:${email}`}</span>;
}

function makeUser(
  overrides?: Partial<{ expired: boolean; access_token: string }>,
) {
  return {
    expired: false,
    access_token: 'access-token',
    profile: { email: 'user@test.com', sub: 'sub-123' },
    ...overrides,
  };
}

// ── AuthProvider ─────────────────────────────────────────────────────────────

describe('AuthProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('shows loading state while session is being restored', () => {
    // Never resolves — stays in loading state
    mockGetUser.mockReturnValue(new Promise(() => {}));
    render(
      <AuthProvider>
        <AuthStatus />
      </AuthProvider>,
    );
    expect(screen.getByTestId('status').textContent).toBe('loading');
  });

  it('restores an active session from sessionStorage', async () => {
    mockGetUser.mockResolvedValue(makeUser());
    render(
      <AuthProvider>
        <AuthStatus />
      </AuthProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId('status').textContent).toBe(
        'authenticated:user@test.com',
      ),
    );
    expect(mockSigninSilent).not.toHaveBeenCalled();
  });

  it('shows unauthenticated when no session exists', async () => {
    mockGetUser.mockResolvedValue(null);
    render(
      <AuthProvider>
        <AuthStatus />
      </AuthProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId('status').textContent).toBe('unauthenticated'),
    );
  });

  it('silently renews an expired token', async () => {
    const renewedUser = makeUser({ access_token: 'new-token' });
    mockGetUser.mockResolvedValue(makeUser({ expired: true }));
    mockSigninSilent.mockResolvedValue(renewedUser);
    render(
      <AuthProvider>
        <AuthStatus />
      </AuthProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId('status').textContent).toBe(
        'authenticated:user@test.com',
      ),
    );
    expect(mockSigninSilent).toHaveBeenCalledOnce();
  });

  it('clears session and shows unauthenticated when silent renewal fails', async () => {
    mockGetUser.mockResolvedValue(makeUser({ expired: true }));
    mockSigninSilent.mockRejectedValue(new Error('renewal failed'));
    mockRemoveUser.mockResolvedValue(undefined);
    render(
      <AuthProvider>
        <AuthStatus />
      </AuthProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId('status').textContent).toBe('unauthenticated'),
    );
    expect(mockRemoveUser).toHaveBeenCalledOnce();
  });

  it('calls signoutRedirect when a component triggers OIDC logout', async () => {
    mockGetUser.mockResolvedValue(makeUser());
    mockSignoutRedirect.mockResolvedValue(undefined);

    function SignOutButton() {
      function handleSignOut() {
        const manager = getOidcManager();
        void manager.signoutRedirect();
      }
      return <button onClick={handleSignOut}>Sign out</button>;
    }

    render(
      <AuthProvider>
        <SignOutButton />
      </AuthProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(mockSignoutRedirect).toHaveBeenCalledOnce());
  });
});

// ── ProtectedRoute ───────────────────────────────────────────────────────────

describe('ProtectedRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('redirects to /signin when unauthenticated', async () => {
    mockGetUser.mockResolvedValue(null);
    render(
      <AuthProvider>
        <ProtectedRoute>
          <span>protected content</span>
        </ProtectedRoute>
      </AuthProvider>,
    );
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/signin'));
    expect(screen.queryByText('protected content')).toBeNull();
  });

  it('renders children when authenticated', async () => {
    mockGetUser.mockResolvedValue(makeUser());
    render(
      <AuthProvider>
        <ProtectedRoute>
          <span>protected content</span>
        </ProtectedRoute>
      </AuthProvider>,
    );
    await waitFor(() =>
      expect(screen.getByText('protected content')).toBeDefined(),
    );
    expect(mockReplace).not.toHaveBeenCalled();
  });
});

// ── AuthCallbackPage ─────────────────────────────────────────────────────────

describe('AuthCallbackPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('calls signinRedirectCallback and redirects to / on success', async () => {
    mockSigninRedirectCallback.mockResolvedValue(undefined);
    render(<CallbackPage />);
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
    expect(mockSigninRedirectCallback).toHaveBeenCalledOnce();
  });

  it('redirects to /signin?error=callback when callback fails', async () => {
    mockSigninRedirectCallback.mockRejectedValue(new Error('callback error'));
    render(<CallbackPage />);
    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith('/signin?error=callback'),
    );
  });
});
