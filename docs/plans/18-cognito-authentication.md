# Step 18 — Add AWS Cognito as a Second Login Option

> Add **AWS Cognito** (Hosted UI, OIDC) as a second sign-in provider alongside the existing Google login, while keeping the **single-allowed-user** model: both providers must resolve to `ALLOWED_EMAIL`. Implemented with Auth.js (NextAuth v5)'s built-in Cognito provider; the User Pool is provisioned via Terraform.

**Estimated effort:** 2–3 hours
**Prerequisites:** Step 17 (Google auth) complete; Step 06 Terraform in place (`terraform/` with `main.tf`, `s3.tf`, `iam.tf`)
**Phase:** 4 — Pre-deployment feature pass

---

## Goal

The `/signin` page offers **two** buttons: "Sign in with Google" and "Sign in with Cognito". A user authenticating through **either** provider is granted a session **only** if their verified email equals `ALLOWED_EMAIL`. Cognito is purely a second authentication method for the same single user — it is **not** a source of AWS credentials, and the S3 upload flow is unchanged (uploads stay server-side through `/api/parse`, using the runtime's IAM role per Steps 06/11). The allowed email and all OAuth secrets remain configuration (env vars), never hardcoded.

## Architecture

Cognito plugs into the existing Auth.js setup as a second OIDC provider. The single-user gate (`isAllowedProfile`) is provider-agnostic — it only inspects the `email` / `email_verified` claims — so it covers Cognito with no behavioral change beyond a small robustness fix for Cognito's claim shape.

```
/signin → [Sign in with Google ] → Google OAuth      ┐
        → [Sign in with Cognito] → Cognito Hosted UI ┘→ /api/auth/callback/{provider}
                                                        → signIn() allowlist (email === ALLOWED_EMAIL)
                                                        → session granted → dashboard
```

## Tasks

### 1. Provision the Cognito User Pool — `terraform/cognito.tf` (create)

Create a User Pool, a confidential app client (with secret + OAuth code flow), and a Hosted-UI domain. The Hosted-UI domain is required because Cognito's OIDC `authorization_endpoint` lives on it.

```hcl
# terraform/cognito.tf

variable "cognito_callback_urls" {
  type        = list(string)
  description = "OAuth redirect URIs for the Cognito app client (dev + prod)."
  default     = ["http://localhost:3000/api/auth/callback/cognito"]
}

variable "cognito_logout_urls" {
  type        = list(string)
  description = "Post-logout redirect URIs for the Cognito Hosted UI (dev + prod)."
  default     = ["http://localhost:3000/signin"]
}

resource "aws_cognito_user_pool" "users" {
  name = "${var.project_name}-users"

  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  password_policy {
    minimum_length    = 12
    require_lowercase = true
    require_uppercase = true
    require_numbers   = true
    require_symbols   = true
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  tags = {
    Project = var.project_name
    Purpose = "App user authentication"
  }
}

# Hosted-UI domain. The prefix must be globally unique within the region.
resource "aws_cognito_user_pool_domain" "users" {
  domain       = "${var.project_name}-${var.bucket_suffix}"
  user_pool_id = aws_cognito_user_pool.users.id
}

resource "aws_cognito_user_pool_client" "web" {
  name         = "${var.project_name}-web"
  user_pool_id = aws_cognito_user_pool.users.id

  # Confidential client — NextAuth's Cognito provider uses a client secret.
  generate_secret = true

  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile"]
  allowed_oauth_flows_user_pool_client = true
  supported_identity_providers         = ["COGNITO"]

  callback_urls = var.cognito_callback_urls
  logout_urls   = var.cognito_logout_urls

  explicit_auth_flows = ["ALLOW_USER_SRP_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"]
}

output "cognito_user_pool_id" {
  value = aws_cognito_user_pool.users.id
}

output "cognito_user_pool_client_id" {
  value = aws_cognito_user_pool_client.web.id
}

output "cognito_user_pool_client_secret" {
  value     = aws_cognito_user_pool_client.web.client_secret
  sensitive = true
}

# The OIDC issuer NextAuth needs (NOT the Hosted-UI domain).
output "cognito_issuer" {
  value = "https://cognito-idp.${var.region}.amazonaws.com/${aws_cognito_user_pool.users.id}"
}

output "cognito_hosted_ui_domain" {
  value = "https://${aws_cognito_user_pool_domain.users.domain}.auth.${var.region}.amazoncognito.com"
}
```

Apply it:
```bash
cd terraform
# auth bridge for an `aws login` SSO session:
eval "$(aws configure export-credentials --format env)"
terraform plan
terraform apply
```
Record the outputs:
```bash
terraform output cognito_user_pool_id
terraform output cognito_user_pool_client_id
terraform output -raw cognito_user_pool_client_secret   # sensitive
terraform output cognito_issuer
```

### 2. Create the single Cognito user (manual — keeps the password out of TF state)

Using the `cognito_user_pool_id` from Task 1 and your `ALLOWED_EMAIL`:
```bash
POOL_ID=<cognito_user_pool_id>
EMAIL=<your ALLOWED_EMAIL>

aws cognito-idp admin-create-user \
  --user-pool-id "$POOL_ID" \
  --username "$EMAIL" \
  --user-attributes Name=email,Value="$EMAIL" Name=email_verified,Value=true \
  --message-action SUPPRESS \
  --region ap-southeast-1

aws cognito-idp admin-set-user-password \
  --user-pool-id "$POOL_ID" \
  --username "$EMAIL" \
  --password '<a-strong-password>' \
  --permanent \
  --region ap-southeast-1
```
- `email_verified=true` is **mandatory** — the allowlist rejects unverified emails, so a user created without it can never sign in.
- `--message-action SUPPRESS` skips the invitation email; `--permanent` avoids the force-change-password challenge (Hosted UI handles change/reset later if needed).

### 3. Add the Cognito provider — `auth.ts` (modify)

```ts
import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import Cognito from 'next-auth/providers/cognito';

import { isAllowedProfile } from '@/lib/auth-allowlist';

const ALLOWED_EMAIL = process.env.ALLOWED_EMAIL;

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({ authorization: { params: { prompt: 'select_account' } } }),
    // Reads AUTH_COGNITO_ID / AUTH_COGNITO_SECRET / AUTH_COGNITO_ISSUER from
    // the environment (Auth.js v5 auto-inference). The same allowlist callback
    // gates this provider — Cognito is a second login method for the single user.
    Cognito,
  ],
  callbacks: {
    signIn({ profile }) {
      return isAllowedProfile(profile, ALLOWED_EMAIL);
    },
  },
  pages: { signIn: '/signin', error: '/signin' },
});
```
- The `signIn` callback is **unchanged** — it already gates by `ALLOWED_EMAIL` for any provider.
- If Auth.js does not auto-detect the issuer at runtime (you'll see an OIDC discovery error on first Cognito sign-in), pass it explicitly: `Cognito({ issuer: process.env.AUTH_COGNITO_ISSUER })`. That is still a `process.env.*` read — no literal.

### 4. Harden the allowlist for Cognito's claim shape — `lib/auth-allowlist.ts` (modify)

Google sends `email_verified` as a boolean; Cognito's ID token may send it as the boolean `true` or, in some flows, the string `"true"`. The current `Boolean(profile?.email_verified && ...)` would wrongly treat the string `"false"` as verified (non-empty strings are truthy). Normalize it:

```ts
/**
 * Pure allowlist decision for app sign-in (Google or Cognito).
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
```

Add tests in `lib/__tests__/auth.test.ts` (modify) covering the new shapes — keep the existing cases:
```ts
import { describe, it, expect } from 'vitest';
import { isAllowedProfile } from '@/lib/auth-allowlist';

const ALLOWED = 'allowed@example.com';

describe('isAllowedProfile — Cognito claim shapes', () => {
  it('accepts string email_verified "true" matching the allowed email', () => {
    expect(isAllowedProfile({ email: ALLOWED, email_verified: 'true' }, ALLOWED)).toBe(true);
  });

  it('rejects string email_verified "false" even when the email matches', () => {
    expect(isAllowedProfile({ email: ALLOWED, email_verified: 'false' }, ALLOWED)).toBe(false);
  });

  it('still accepts boolean email_verified true (Google shape)', () => {
    expect(isAllowedProfile({ email: ALLOWED, email_verified: true }, ALLOWED)).toBe(true);
  });
});
```

### 5. Add the Cognito sign-in button — `app/signin/page.tsx` (modify)

Add a second form below the Google one (the shared `?error=` hint already covers rejection for both providers):
```tsx
<form
  className="mt-3"
  action={async () => {
    "use server";
    await signIn("cognito", { redirectTo: "/" });
  }}
>
  <Button type="submit" variant="outline" className="w-full">
    Sign in with Cognito
  </Button>
</form>
```
- The provider id is `cognito`, so the callback path is `/api/auth/callback/cognito` — already covered by the middleware matcher's `api/auth` exclusion (no middleware change).
- Use the existing `Button` variants for visual distinction (Google = default, Cognito = `outline`).

### 6. Secret configuration — `.env.example` (modify)

Append the Cognito block (empty placeholders + comment, matching the existing Auth.js block):
```
# AWS Cognito (second login option) — from `terraform output` (Step 18)
AUTH_COGNITO_ID=
AUTH_COGNITO_SECRET=
AUTH_COGNITO_ISSUER=
```
- `AUTH_COGNITO_ID` = `terraform output cognito_user_pool_client_id`
- `AUTH_COGNITO_SECRET` = `terraform output -raw cognito_user_pool_client_secret`
- `AUTH_COGNITO_ISSUER` = `terraform output cognito_issuer` (e.g. `https://cognito-idp.ap-southeast-1.amazonaws.com/ap-southeast-1_XXXXXXXXX`)

Real values go only in `.env.local` (dev) and the Amplify Console (prod). **Never commit them.**

### 7. Update deployment docs

- `docs/plans/11-amplify-deployment.md` (modify) — add to the env-var checklist: `AUTH_COGNITO_ID`, `AUTH_COGNITO_SECRET`, `AUTH_COGNITO_ISSUER`.
- `docs/auth-setup-todo.md` (modify) — add a "Cognito" section: run `terraform apply` for the pool, create the single user (Task 2), and **add the prod URLs** to `cognito_callback_urls` / `cognito_logout_urls` (e.g. `https://<amplify-domain>/api/auth/callback/cognito` and `https://<amplify-domain>/signin`) then re-apply.

### 8. Verify

```bash
pnpm tsc --noEmit   # clean
pnpm lint           # clean
pnpm test           # all pass, incl. new Cognito allowlist cases
pnpm build          # green on Next 16.2.6
```
Then manual (dev): restart `pnpm dev`, open `/signin`, confirm **both** buttons; sign in via Cognito as `ALLOWED_EMAIL` → dashboard; sign in via Cognito as a different pool user → bounced to `/signin` with the access-denied hint.

## Files affected

- `terraform/cognito.tf` — **create** (User Pool, client, domain, outputs)
- `auth.ts` — modify (add Cognito provider)
- `lib/auth-allowlist.ts` — modify (normalize `email_verified`)
- `lib/__tests__/auth.test.ts` — modify (Cognito claim-shape cases)
- `app/signin/page.tsx` — modify (second button)
- `.env.example` — modify (Cognito vars)
- `docs/plans/11-amplify-deployment.md` — modify (env-var checklist)
- `docs/auth-setup-todo.md` — modify (Cognito setup steps)
- `package.json` — no change (`next-auth` already installed; the Cognito provider ships with it)

## Acceptance criteria

- `/signin` shows two buttons: "Sign in with Google" and "Sign in with Cognito".
- Signing in via **Cognito** as `ALLOWED_EMAIL` → reaches the dashboard; nav shows the email + Sign out.
- Signing in via **Cognito** as any other pool user → rejected back to `/signin` with the access-denied hint, no session.
- Google sign-in continues to work exactly as before (single-user gate intact).
- API routes still return `401` when unauthenticated.
- `grep -rn "ALLOWED_EMAIL\|AUTH_GOOGLE\|AUTH_SECRET\|AUTH_COGNITO" .` (excluding `.env.local`) shows only `process.env.*` reads and `.env.example` placeholders — **no literal email or secret**.
- `terraform plan` is clean after apply (no drift).
- `pnpm build`, `pnpm lint`, `pnpm test` pass.

## Notes & gotchas

- **Issuer vs Hosted-UI domain.** NextAuth's Cognito `issuer` is the User Pool endpoint (`https://cognito-idp.<region>.amazonaws.com/<poolId>`), used for OIDC discovery. The discovery doc's `authorization_endpoint` points at the **Hosted-UI domain** — which is why Task 1 creates `aws_cognito_user_pool_domain`. Both must exist or sign-in fails.
- **`email_verified` must be true on the user.** An admin-created user without `email_verified=true` will always fail the allowlist (Task 2 sets it explicitly).
- **Callback/logout URLs are exact-match.** The dev URL `http://localhost:3000/api/auth/callback/cognito` must be in `callback_urls`; add the prod Amplify URL before/at deploy (Task 7) or production sign-in returns a redirect-mismatch error.
- **Hosted-UI sign-out is separate from the app session.** `signOut()` clears the NextAuth session but not Cognito's Hosted-UI cookie, so a subsequent Cognito login may skip the password prompt. A full federated logout (redirect to the Hosted-UI `/logout` endpoint with `client_id` + `logout_uri`) is an **optional** enhancement, unnecessary for single-user.
- **Hosted-UI domain prefix is globally unique per region.** If `${project_name}-${bucket_suffix}` collides, `terraform apply` errors — pick another suffix.
- **No new dependency.** `next-auth@5` already bundles `next-auth/providers/cognito`; do not install anything.
- **AWS auth bridge for Terraform.** An `aws login` SSO session needs `eval "$(aws configure export-credentials --format env)"` before `terraform plan/apply`.

## Next step

[Step 11 — Deploy to AWS Amplify](./11-amplify-deployment.md) — now including the Cognito env vars and prod callback/logout URLs alongside the Step 16/17 auth + PDF vars.
