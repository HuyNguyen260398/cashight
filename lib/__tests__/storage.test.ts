/**
 * Vitest suite for storage error classification.
 *
 * isAuthError must recognise the AWS SDK error names that indicate a
 * credentials/authentication/authorization problem (so routes can return a
 * helpful "re-authenticate" message) and must NOT mis-classify ordinary
 * errors (so genuine bugs aren't masked as auth issues).
 */

import { describe, it, expect } from 'vitest';
import { isAuthError, getStorageRegion } from '@/lib/storage';

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

describe('getStorageRegion', () => {
  it('prefers STORAGE_REGION over AWS_REGION because Amplify reserves AWS_* env names', () => {
    expect(getStorageRegion({ STORAGE_REGION: 'ap-southeast-1', AWS_REGION: 'us-east-1' })).toBe(
      'ap-southeast-1',
    );
  });

  it('falls back to AWS_REGION for local development', () => {
    expect(getStorageRegion({ AWS_REGION: 'ap-southeast-1' })).toBe('ap-southeast-1');
  });

  it('uses the deployed app region when no region env var is available', () => {
    expect(getStorageRegion({})).toBe('ap-southeast-1');
  });
});
