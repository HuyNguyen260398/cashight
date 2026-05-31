# Authentication — Remaining Setup TODO

> Step 17 (Google auth) code is **done and merged via PR #22**. What remains is the
> manual configuration the code can't do for you: Google Cloud OAuth, secrets, and
> end-to-end verification. Work through these in order.

## 1. Generate `AUTH_SECRET`

```bash
npx auth secret
# or:
openssl rand -base64 32
```

- [ ] Generated a secret (keep it; you'll paste it into `.env.local` and the Amplify Console).

## 2. Create the Google OAuth client

In [Google Cloud Console](https://console.cloud.google.com/) → **APIs & Services → Credentials**:

- [ ] Create (or pick) a project.
- [ ] **Configure the OAuth consent screen** (External, app name `Cashight`, your email as support/developer contact). Add your Google account as a **Test user** while the app is in "Testing" status, or only that account will be able to authenticate.
- [ ] **Create credentials → OAuth client ID → Web application.**
- [ ] **Authorized redirect URIs** — add both:
  - `http://localhost:3000/api/auth/callback/google` (dev)
  - `https://<your-amplify-domain>/api/auth/callback/google` (prod — add once you know the domain)
- [ ] Copy the **Client ID** → `AUTH_GOOGLE_ID`, **Client secret** → `AUTH_GOOGLE_SECRET`.

## 3. Local dev config — `.env.local` (gitignored, never commit)

Add the four auth vars (placeholders are in `.env.example`):

```
AUTH_SECRET=<from step 1>
AUTH_GOOGLE_ID=<from step 2>
AUTH_GOOGLE_SECRET=<from step 2>
ALLOWED_EMAIL=<the single Google account allowed to sign in>
```

- [ ] All four set in `.env.local`.
- [ ] `ALLOWED_EMAIL` is the exact verified email of the Google account you'll sign in with.

## 4. Verify locally (`pnpm dev`)

- [ ] Visiting `/` while signed out → redirected to `/signin`.
- [ ] Signing in with the **allowed** account → reaches the dashboard; nav shows your email + **Sign out**.
- [ ] Signing in with a **different** Google account → bounced back to `/signin` with the access-denied hint, no session granted.
- [ ] `GET /api/parse` (or `/api/summarize`, `/api/statements`) while signed out → `401`.
- [ ] **Sign out** → returns to `/signin`.

## 5. Production (Amplify) — at deploy time (Step 11)

Set these in **Amplify Console → App settings → Environment variables** (never in `amplify.yml`):

- [ ] `AUTH_SECRET`
- [ ] `AUTH_GOOGLE_ID`
- [ ] `AUTH_GOOGLE_SECRET`
- [ ] `ALLOWED_EMAIL`
- [ ] `PDF_PASSWORD` (from Step 16)
- [ ] **`AUTH_TRUST_HOST=true`** — NextAuth v5 needs this behind Amplify's proxy to build correct callback URLs. Without it, the Google callback can fail in prod.
- [ ] Add the **prod redirect URI** (`https://<amplify-domain>/api/auth/callback/google`) to the Google OAuth client (step 2).
- [ ] If the OAuth consent screen is still in "Testing", either keep `ALLOWED_EMAIL` listed as a test user or **publish** the consent screen.

## 6. After first prod deploy — re-verify the auth flow

- [ ] Signed-out → `/signin` on the live domain.
- [ ] Allowed account signs in successfully; others rejected.
- [ ] Sign out works.

---

### Reference

- Plan: [`docs/plans/17-google-auth.md`](./plans/17-google-auth.md)
- Deploy env-var checklist: [`docs/plans/11-amplify-deployment.md`](./plans/11-amplify-deployment.md)
- Auth.js (NextAuth v5) docs: https://authjs.dev
