/**
 * Vitest suite for lib/auth-allowlist.ts.
 *
 * Tests the pure `isAllowedProfile` helper in isolation — no NextAuth runtime
 * or environment variables required.
 */

import { describe, it, expect } from 'vitest';

import { isAllowedProfile } from '@/lib/auth-allowlist';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALLOWED = 'allowed@example.com';
const OTHER = 'other@example.com';

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('isAllowedProfile', () => {
  // 1. Verified email that matches allowedEmail → true
  it('returns true when email is verified and matches allowedEmail', () => {
    expect(
      isAllowedProfile({ email: ALLOWED, email_verified: true }, ALLOWED),
    ).toBe(true);
  });

  // 2. Verified email that does NOT match allowedEmail → false
  it('returns false when email is verified but does not match allowedEmail', () => {
    expect(
      isAllowedProfile({ email: OTHER, email_verified: true }, ALLOWED),
    ).toBe(false);
  });

  // 3. Email matches but email_verified is false → false
  it('returns false when email matches but email_verified is false', () => {
    expect(
      isAllowedProfile({ email: ALLOWED, email_verified: false }, ALLOWED),
    ).toBe(false);
  });

  // 3b. Email matches but email_verified is missing/null → false
  it('returns false when email matches but email_verified is null', () => {
    expect(
      isAllowedProfile({ email: ALLOWED, email_verified: null }, ALLOWED),
    ).toBe(false);
  });

  it('returns false when email matches but email_verified is undefined', () => {
    expect(
      isAllowedProfile({ email: ALLOWED }, ALLOWED),
    ).toBe(false);
  });

  // 4. allowedEmail is undefined (even with a valid verified matching profile) → false
  it('returns false when allowedEmail is undefined', () => {
    expect(
      isAllowedProfile({ email: ALLOWED, email_verified: true }, undefined),
    ).toBe(false);
  });

  // Edge: allowedEmail is empty string → false
  it('returns false when allowedEmail is empty string', () => {
    expect(
      isAllowedProfile({ email: '', email_verified: true }, ''),
    ).toBe(false);
  });

  // Edge: profile is null → false
  it('returns false when profile is null', () => {
    expect(isAllowedProfile(null, ALLOWED)).toBe(false);
  });

  // Edge: profile is undefined → false
  it('returns false when profile is undefined', () => {
    expect(isAllowedProfile(undefined, ALLOWED)).toBe(false);
  });
});
