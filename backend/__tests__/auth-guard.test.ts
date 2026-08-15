import { describe, expect, it, vi } from 'vitest';

import {
  createAuthGuardHandler,
  deriveAuthProvider,
} from '../functions/auth-guard/handler';

function event(
  triggerSource: string,
  attributes: Record<string, string | undefined>,
) {
  return {
    triggerSource,
    request: { userAttributes: attributes },
    response: {},
  };
}

describe('Cognito auth guard', () => {
  it('allows the verified allowlisted external provider during pre-sign-up', async () => {
    const upsertAuthorizedUser = vi.fn();
    const handler = createAuthGuardHandler({
      allowedEmail: 'huy@example.com',
      upsertAuthorizedUser,
      now: () => new Date('2026-06-27T12:00:00.000Z'),
    });
    const input = event('PreSignUp_ExternalProvider', {
      sub: 'google_123',
      email: '  HUY@EXAMPLE.COM ',
      email_verified: 'true',
    });

    await expect(handler(input)).resolves.toBe(input);
    expect(upsertAuthorizedUser).not.toHaveBeenCalled();
  });

  it.each([
    { email: 'other@example.com', email_verified: 'true' },
    { email: 'huy@example.com', email_verified: 'false' },
    { email: undefined, email_verified: 'true' },
  ])('rejects unapproved external identities', async (attributes) => {
    const handler = createAuthGuardHandler({
      allowedEmail: 'huy@example.com',
      upsertAuthorizedUser: vi.fn(),
      now: () => new Date('2026-06-27T12:00:00.000Z'),
    });

    await expect(
      handler(
        event('PreSignUp_ExternalProvider', {
          sub: 'google_123',
          ...attributes,
        }),
      ),
    ).rejects.toThrow('AccessDenied');
  });

  it('maps a native Cognito identity to the primary workspace', async () => {
    const upsertAuthorizedUser = vi.fn().mockResolvedValue(undefined);
    const handler = createAuthGuardHandler({
      allowedEmail: 'huy@example.com',
      upsertAuthorizedUser,
      now: () => new Date('2026-06-27T12:00:00.000Z'),
    });
    const input = event('TokenGeneration_HostedAuth', {
      sub: 'stable-cognito-sub',
      email: 'huy@example.com',
      email_verified: 'true',
    });

    await expect(handler(input)).resolves.toBe(input);
    expect(upsertAuthorizedUser).toHaveBeenCalledWith({
      PK: 'AUTHZ#stable-cognito-sub',
      SK: 'PROFILE',
      active: true,
      workspaceId: 'primary',
      authProvider: 'COGNITO',
      createdAt: '2026-06-27T12:00:00.000Z',
      updatedAt: '2026-06-27T12:00:00.000Z',
    });
    expect(
      JSON.stringify(upsertAuthorizedUser.mock.calls).includes('huy@example.com'),
    ).toBe(false);
  });

  it('maps a trusted Google identity to the primary workspace', async () => {
    const upsertAuthorizedUser = vi.fn().mockResolvedValue(undefined);
    const handler = createAuthGuardHandler({
      allowedEmail: 'huy@example.com',
      upsertAuthorizedUser,
      now: () => new Date('2026-06-27T12:00:00.000Z'),
    });
    const input = event('TokenGeneration_HostedAuth', {
      sub: 'google-subject',
      email: 'huy@example.com',
      email_verified: 'true',
      identities: JSON.stringify([
        {
          userId: '123',
          providerName: 'Google',
          providerType: 'Google',
          issuer: null,
          primary: 'true',
          dateCreated: '1785758400000',
        },
      ]),
    });

    await expect(handler(input)).resolves.toBe(input);
    expect(upsertAuthorizedUser).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'primary',
        authProvider: 'GOOGLE',
      }),
    );
  });

  it.each([
    '{not-json',
    '[]',
    JSON.stringify([{ providerName: 'Facebook' }]),
    JSON.stringify([{ providerName: 'Google' }, { providerName: 'Google' }]),
  ])('rejects malformed or unsupported trusted identities: %s', async (identities) => {
    const handler = createAuthGuardHandler({
      allowedEmail: 'huy@example.com',
      upsertAuthorizedUser: vi.fn(),
      now: () => new Date('2026-06-27T12:00:00.000Z'),
    });

    await expect(
      handler(
        event('TokenGeneration_HostedAuth', {
          sub: 'external-subject',
          email: 'huy@example.com',
          email_verified: 'true',
          identities,
        }),
      ),
    ).rejects.toThrow('AccessDenied');
  });

  it('rejects token generation without a stable subject', async () => {
    const handler = createAuthGuardHandler({
      allowedEmail: 'huy@example.com',
      upsertAuthorizedUser: vi.fn(),
      now: () => new Date('2026-06-27T12:00:00.000Z'),
    });

    await expect(
      handler(
        event('TokenGeneration_Authentication', {
          email: 'huy@example.com',
          email_verified: 'true',
        }),
      ),
    ).rejects.toThrow('AccessDenied');
  });
});

describe('deriveAuthProvider', () => {
  it('does not inspect untrusted fields outside Cognito user attributes', () => {
    expect(deriveAuthProvider({})).toBe('COGNITO');
  });
});
