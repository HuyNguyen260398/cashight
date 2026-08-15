// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SessionCapabilitiesSchema } from '../api/contracts';
import { useSessionCapabilities } from '../hooks/use-session-capabilities';

const mockApiFetch = vi.fn();
let currentSubject = 'subject-one';

vi.mock('../api/client', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

vi.mock('../auth/config', () => ({
  getPublicConfig: () => ({ apiBaseUrl: 'https://api.example.com' }),
}));

vi.mock('../auth/auth-provider', () => ({
  useAuth: () => ({
    user: {
      profile: { sub: currentSubject },
      expired: false,
      access_token: 'token',
    },
    loading: false,
  }),
}));

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('SessionCapabilitiesSchema', () => {
  it('rejects malformed capability responses', () => {
    expect(() =>
      SessionCapabilitiesSchema.parse({ canViewAwsCosts: 'yes' }),
    ).toThrow();
  });
});

describe('useSessionCapabilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentSubject = crypto.randomUUID();
  });

  it('loads and parses server-derived capabilities', async () => {
    mockApiFetch.mockResolvedValue(response({ canViewAwsCosts: true }));

    const { result } = renderHook(() => useSessionCapabilities());

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual({ canViewAwsCosts: true });
    expect(result.current.error).toBeNull();
    expect(mockApiFetch).toHaveBeenCalledWith(
      'https://api.example.com/session/capabilities',
    );
  });

  it('caches one resolved response for the current OIDC user', async () => {
    mockApiFetch.mockResolvedValue(response({ canViewAwsCosts: true }));

    const first = renderHook(() => useSessionCapabilities());
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    first.unmount();
    const second = renderHook(() => useSessionCapabilities());
    await waitFor(() => expect(second.result.current.loading).toBe(false));

    expect(second.result.current.data).toEqual({ canViewAwsCosts: true });
    expect(mockApiFetch).toHaveBeenCalledOnce();
  });

  it('clears the cache when the OIDC subject changes', async () => {
    mockApiFetch
      .mockResolvedValueOnce(response({ canViewAwsCosts: true }))
      .mockResolvedValueOnce(
        response({
          canViewAwsCosts: false,
          reason: 'COGNITO_REAUTH_REQUIRED',
        }),
      );
    const hook = renderHook(() => useSessionCapabilities());
    await waitFor(() => expect(hook.result.current.loading).toBe(false));

    currentSubject = crypto.randomUUID();
    hook.rerender();

    await waitFor(() =>
      expect(hook.result.current.data).toEqual({
        canViewAwsCosts: false,
        reason: 'COGNITO_REAUTH_REQUIRED',
      }),
    );
    expect(mockApiFetch).toHaveBeenCalledTimes(2);
  });

  it('returns a retryable network error and reloads on demand', async () => {
    mockApiFetch
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValueOnce(response({ canViewAwsCosts: true }));
    const { result } = renderHook(() => useSessionCapabilities());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('network unavailable');

    act(() => result.current.reload());

    await waitFor(() =>
      expect(result.current.data).toEqual({ canViewAwsCosts: true }),
    );
    expect(result.current.error).toBeNull();
  });

  it('does not publish a response after the component unmounts', async () => {
    let resolveFetch: ((value: Response) => void) | undefined;
    mockApiFetch.mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      }),
    );
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const hook = renderHook(() => useSessionCapabilities());

    hook.unmount();
    await act(async () => {
      resolveFetch?.(response({ canViewAwsCosts: true }));
      await Promise.resolve();
    });

    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
