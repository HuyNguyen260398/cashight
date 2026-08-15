import { describe, expect, it } from 'vitest';

import {
  AuthorizedWorkspaceSchema,
  SessionCapabilitiesSchema,
} from '@cashight/domain/workspace';

describe('AuthorizedWorkspaceSchema', () => {
  it('accepts the primary workspace with a trusted provider', () => {
    expect(
      AuthorizedWorkspaceSchema.parse({
        workspaceId: 'primary',
        authProvider: 'COGNITO',
      }),
    ).toEqual({ workspaceId: 'primary', authProvider: 'COGNITO' });
  });

  it('rejects a caller-selected workspace', () => {
    expect(() =>
      AuthorizedWorkspaceSchema.parse({
        workspaceId: 'user-supplied',
        authProvider: 'GOOGLE',
      }),
    ).toThrow();
  });

  it('rejects an unsupported provider', () => {
    expect(() =>
      AuthorizedWorkspaceSchema.parse({
        workspaceId: 'primary',
        authProvider: 'GITHUB',
      }),
    ).toThrow();
  });
});

describe('SessionCapabilitiesSchema', () => {
  it('accepts native Cognito capabilities without a reason', () => {
    expect(
      SessionCapabilitiesSchema.parse({ canViewAwsCosts: true }),
    ).toEqual({ canViewAwsCosts: true });
  });

  it('accepts the Cognito reauthentication reason for Google sessions', () => {
    expect(
      SessionCapabilitiesSchema.parse({
        canViewAwsCosts: false,
        reason: 'COGNITO_REAUTH_REQUIRED',
      }),
    ).toEqual({
      canViewAwsCosts: false,
      reason: 'COGNITO_REAUTH_REQUIRED',
    });
  });

  it('rejects unknown capability reasons', () => {
    expect(() =>
      SessionCapabilitiesSchema.parse({
        canViewAwsCosts: false,
        reason: 'UNTRUSTED_PROVIDER',
      }),
    ).toThrow();
  });
});
