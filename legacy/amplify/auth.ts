import NextAuth from 'next-auth';
import Cognito from 'next-auth/providers/cognito';
import Google from 'next-auth/providers/google';

import { isAllowedProfile } from '@/lib/auth-allowlist';

const ALLOWED_EMAIL = process.env.ALLOWED_EMAIL;

export const { handlers, auth, signIn, signOut } = NextAuth({
  // Auth.js refuses to operate on a host it doesn't trust and (in v5) `auth()`
  // then returns a truthy error object instead of null — which silently defeats
  // `if (!session)` guards (fail-open). On Amplify the runtime sits behind
  // CloudFront, so the host is never auto-trusted; trust it explicitly. Without
  // this, every auth() call logs `UntrustedHost` and the app has no auth gate.
  trustHost: true,
  providers: [
    // prompt=select_account forces Google's account chooser on every sign-in,
    // so a user rejected by the allowlist can retry with a different account
    // instead of silently re-submitting the same one.
    Google({ authorization: { params: { prompt: 'select_account' } } }),
    // Reads AUTH_COGNITO_ID / AUTH_COGNITO_SECRET / AUTH_COGNITO_ISSUER from the
    // environment (Auth.js v5 auto-inference). Cognito accepts client_secret_post
    // reliably for confidential app clients, including secrets with special chars.
    Cognito({ client: { token_endpoint_auth_method: 'client_secret_post' } }),
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
