import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';

import { isAllowedProfile } from '@/lib/auth-allowlist';

const ALLOWED_EMAIL = process.env.ALLOWED_EMAIL;

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    // prompt=select_account forces Google's account chooser on every sign-in,
    // so a user rejected by the allowlist can retry with a different account
    // instead of silently re-submitting the same one.
    Google({ authorization: { params: { prompt: 'select_account' } } }),
  ],
  callbacks: {
    // Reject any account whose verified email is not the single allowed one.
    signIn({ profile }) {
      return isAllowedProfile(profile, ALLOWED_EMAIL);
    },
  },
  // A rejected sign-in throws AccessDenied, whose `kind` is "error" (not
  // "signIn"), so it routes to `pages.error`. Point that at our own /signin
  // page; otherwise it lands on Auth.js's built-in error page, whose "Sign in"
  // link is broken and dead-ends on the generic "Error" page.
  pages: { signIn: '/signin', error: '/signin' },
});
