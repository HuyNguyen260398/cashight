import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';

import { isAllowedProfile } from '@/lib/auth-allowlist';

const ALLOWED_EMAIL = process.env.ALLOWED_EMAIL;

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  callbacks: {
    // Reject any account whose verified email is not the single allowed one.
    signIn({ profile }) {
      return isAllowedProfile(profile, ALLOWED_EMAIL);
    },
  },
  pages: { signIn: '/signin' },
});
