# Step 17 — Google Authentication (Single Allowed User)

> Lock the entire app behind Google sign-in, allowing **only one** email address (stored as an env var). Implemented with Auth.js (NextAuth v5).

**Estimated effort:** 2–3 hours
**Prerequisites:** Steps 12–16 complete (so the gated app is feature-complete)
**Phase:** 4 — Pre-deployment feature pass

---

## Goal

Every page and API route requires an authenticated session. A visitor signs in with Google; the session is granted **only** if their verified email equals `ALLOWED_EMAIL`. Anyone else is rejected even after a successful Google login. The allowed email is configuration, never hardcoded.

## Tasks

### 1. Install Auth.js

```bash
pnpm add next-auth@beta
```
`next-auth@5` is the v5 line (Auth.js). Pin whatever version resolves at install; **verify it builds against Next 16.2.6** (`pnpm build`). If there is a hard incompatibility, stop and reassess before improvising.

### 2. Auth config — `auth.ts` (create, repo root)

```ts
import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';

const ALLOWED_EMAIL = process.env.ALLOWED_EMAIL;

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  callbacks: {
    // Reject any account whose verified email is not the single allowed one.
    signIn({ profile }) {
      return Boolean(
        profile?.email_verified &&
        ALLOWED_EMAIL &&
        profile.email === ALLOWED_EMAIL,
      );
    },
  },
  pages: { signIn: '/signin' },
});
```

- The allowlist check is **server-side** in the `signIn` callback. The email is read from `process.env.ALLOWED_EMAIL` — never a literal.
- Optionally fail fast at startup if `ALLOWED_EMAIL` / `AUTH_SECRET` are unset (mirrors the project's "crash if `STATEMENTS_BUCKET` unset" convention).

### 3. Route handler — `app/api/auth/[...nextauth]/route.ts` (create)

```ts
import { handlers } from '@/auth';
export const { GET, POST } = handlers;
export const runtime = 'nodejs';
```

### 4. Middleware gate — `middleware.ts` (create, repo root)

- Export the `auth` middleware so **all** routes require a session, except:
  - `/api/auth/*` (the Auth.js endpoints)
  - `/signin`
  - Next static assets (`/_next/*`, favicon, etc.)
- Unauthenticated requests to a page → redirect to `/signin`. Unauthenticated requests to other API routes → `401`.
- Use a `matcher` config that excludes static assets and the auth/signin paths.

### 5. Sign-in page — `app/signin/page.tsx` (create)

- Minimal page: app name + a "Sign in with Google" button that calls the server `signIn('google')` action (or a small client form posting to it).
- Optionally show an "access denied" hint when redirected back after a rejected (non-allowlisted) login (Auth.js appends `?error=AccessDenied`).

### 6. Header: signed-in identity + sign out — `app/layout.tsx` (modify)

- Show the signed-in email (small, `text-muted-foreground`) and a **Sign out** button (calls `signOut()`), placed in the nav near the theme toggle from Step 13.
- The layout can read the session via `auth()` (it's an async server component-friendly helper) — or factor the nav into a small server component that awaits `auth()`.

### 7. Secret configuration — `.env.example` (modify)

Add empty placeholders + comments:
```
# Auth.js (Google) — single-user access control
AUTH_SECRET=
AUTH_GOOGLE_ID=
AUTH_GOOGLE_SECRET=
ALLOWED_EMAIL=
```
Real values go only in `.env.local` (dev) and the Amplify Console (prod). **Never commit them.**

### 8. Google Cloud setup (manual, document in README/notes)

You (the user) must, in Google Cloud Console:
- Create an OAuth 2.0 Client ID (type: Web application).
- Authorized redirect URIs:
  - `http://localhost:3000/api/auth/callback/google` (dev)
  - `https://<your-amplify-domain>/api/auth/callback/google` (prod)
- Copy the client ID/secret into `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`.
- Generate `AUTH_SECRET` with `npx auth secret` (or `openssl rand -base64 32`).

### 9. Test — `lib/__tests__/auth.test.ts` (optional)

- Unit-test the `signIn` callback logic (extract it to a small pure helper if needed): allowed verified email → `true`; different email → `false`; unverified email → `false`; missing `ALLOWED_EMAIL` → `false`.

## Files affected

- `auth.ts` — **create**
- `app/api/auth/[...nextauth]/route.ts` — **create**
- `middleware.ts` — **create**
- `app/signin/page.tsx` — **create**
- `app/layout.tsx` — modify (identity + sign-out in nav)
- `.env.example` — modify (auth vars)
- `package.json` — modify (`next-auth` dep)
- `lib/__tests__/auth.test.ts` — **create** (optional)

## Acceptance criteria

- Visiting `/` (or any page) while signed out → redirected to `/signin`.
- Signing in with the allowed Google account → reaches the dashboard; nav shows the email + Sign out.
- Signing in with **any other** Google account → rejected (back to `/signin` with an access-denied indication), no session granted.
- API routes (`/api/parse`, `/api/summarize`, `/api/statements`) return `401` when unauthenticated.
- Sign out returns to `/signin`.
- `grep -rn "ALLOWED_EMAIL\|AUTH_GOOGLE\|AUTH_SECRET" .` (excluding `.env.local`) shows only `process.env.*` reads and `.env.example` placeholders — **no literal email or secret**.
- `pnpm build`, `pnpm lint`, `pnpm test` pass.

## Notes & gotchas

- **Secret handling is the point.** The allowed email and all OAuth secrets are env vars only; the allowlist decision runs server-side in the `signIn` callback. The client never receives the allowlist.
- **Next 16 + NextAuth v5:** v5 is beta and officially targets Next 14/15. Confirm the build is green on 16.2.6 immediately after install; if blocked, surface it rather than hacking around it.
- **Middleware matcher** is the easy thing to get wrong — make sure `/_next/static`, `/_next/image`, `favicon.ico`, `/signin`, and `/api/auth/*` are excluded, or you'll lock yourself out of the sign-in page.
- This step adds new production env vars — **update the Step 11 Amplify deployment env-var checklist** to include `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `ALLOWED_EMAIL`, and `PDF_PASSWORD` (from Step 16).

## Next step

[Step 11 — Deploy to AWS Amplify](./11-amplify-deployment.md) — now including the new auth + PDF env vars.
