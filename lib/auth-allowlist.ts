/**
 * Pure allowlist decision for Google or Cognito sign-in.
 *
 * Returns true only when the OAuth profile carries a verified email that
 * exactly matches the single allowed address. Kept free of NextAuth runtime
 * so it can be unit-tested in isolation.
 */
export interface AllowlistProfile {
  email?: string | null;
  // Google: boolean. Cognito: boolean or the string "true"/"false".
  email_verified?: boolean | string | null;
}

// Strict, fail-closed: only the canonical boolean `true` or string "true" count
// as verified. Anything else (the string "false", numbers, objects, null) is
// treated as unverified — never coerced via truthiness.
function isEmailVerified(value: AllowlistProfile['email_verified']): boolean {
  return value === true || value === 'true';
}

export function isAllowedProfile(
  profile: AllowlistProfile | null | undefined,
  allowedEmail: string | undefined,
): boolean {
  return Boolean(
    profile &&
      isEmailVerified(profile.email_verified) &&
      allowedEmail &&
      profile.email === allowedEmail,
  );
}
