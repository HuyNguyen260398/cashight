/**
 * Pure allowlist decision for Google sign-in.
 *
 * Returns true only when the OAuth profile carries a verified email that
 * exactly matches the single allowed address. Kept free of NextAuth runtime
 * so it can be unit-tested in isolation.
 */
export interface AllowlistProfile {
  email?: string | null;
  email_verified?: boolean | null;
}

export function isAllowedProfile(
  profile: AllowlistProfile | null | undefined,
  allowedEmail: string | undefined,
): boolean {
  return Boolean(
    profile?.email_verified &&
      allowedEmail &&
      profile.email === allowedEmail,
  );
}
