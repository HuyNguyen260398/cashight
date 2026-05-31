/**
 * Vitest suite for storage error classification.
 *
 * isAuthError must recognise the AWS SDK error names that indicate a
 * credentials/authentication/authorization problem (so routes can return a
 * helpful "re-authenticate" message) and must NOT mis-classify ordinary
 * errors (so genuine bugs aren't masked as auth issues).
 */

import { describe, it, expect } from 'vitest';
import { isAuthError } from '@/lib/storage';

describe('isAuthError', () => {
  it.each([
    'CredentialsProviderError',
    'ExpiredToken',
    'ExpiredTokenException',
    'InvalidToken',
    'TokenRefreshRequired',
    'UnrecognizedClientException',
    'AccessDenied',
    'AccessDeniedException',
  ])('classifies %s as an auth error', (name) => {
    expect(isAuthError({ name })).toBe(true);
  });

  it('does not classify NoSuchKey / NotFound as auth errors', () => {
    expect(isAuthError({ name: 'NoSuchKey' })).toBe(false);
    expect(isAuthError({ name: 'NotFound' })).toBe(false);
  });

  it('does not classify a generic Error as an auth error', () => {
    expect(isAuthError(new Error('boom'))).toBe(false);
  });

  it('handles non-error / nullish inputs without throwing', () => {
    expect(isAuthError(undefined)).toBe(false);
    expect(isAuthError(null)).toBe(false);
    expect(isAuthError('string')).toBe(false);
    expect(isAuthError({})).toBe(false);
  });
});
