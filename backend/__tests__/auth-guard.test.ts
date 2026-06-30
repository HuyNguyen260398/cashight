import { describe, expect, it, vi } from 'vitest';

import { createAuthGuardHandler } from '../functions/auth-guard/handler';

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

  it('upserts only the stable subject during token generation', async () => {
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
      createdAt: '2026-06-27T12:00:00.000Z',
      updatedAt: '2026-06-27T12:00:00.000Z',
    });
    expect(
      JSON.stringify(upsertAuthorizedUser.mock.calls).includes('huy@example.com'),
    ).toBe(false);
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
