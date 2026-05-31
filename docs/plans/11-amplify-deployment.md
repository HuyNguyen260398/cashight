# Step 11 — Deploy to AWS Amplify

> Get the app running in production on AWS Amplify Hosting compute with all environment variables, IAM permissions, and the right Next.js 15 build configuration.

**Estimated effort:** 1–2 hours
**Prerequisites:** Step 10
**Phase:** 3 — Polish / Deployment

---

## Goal

The app is live at a public URL (an `amplifyapp.com` subdomain or your own domain). Pushes to `main` auto-deploy. Environment variables are configured. The Amplify service role has S3 permissions.

## Tasks

### 1. Push to GitHub

The repo needs to be on GitHub for Amplify to connect:

```bash
git remote add origin git@github.com:huy/expense-tracker.git
git push -u origin main
```

Confirm `.env.local` is gitignored. Verify nothing in the commit history contains `GEMINI_API_KEY` or AWS keys. If it does:
```bash
# Rotate the key immediately, then clean history before pushing
```

### 2. Create `amplify.yml`

In the repo root:

```yaml
version: 1
frontend:
  phases:
    preBuild:
      commands:
        - corepack enable
        - corepack prepare pnpm@latest --activate
        - pnpm install --frozen-lockfile
    build:
      commands:
        - pnpm run build
  artifacts:
    baseDirectory: .next
    files:
      - '**/*'
  cache:
    paths:
      - node_modules/**/*
      - .next/cache/**/*
```

Commit and push.

### 3. Connect repo in Amplify Console

1. Open [AWS Amplify Console](https://console.aws.amazon.com/amplify) in `ap-southeast-1`
2. **New app → Host web app**
3. Choose GitHub → authorize → select `expense-tracker` repo → `main` branch
4. Amplify detects Next.js automatically (it should display "Next.js - SSR")
5. Review the build settings — should match `amplify.yml` from step 2
6. **Advanced settings → Environment variables:**
   - `GEMINI_API_KEY` = `<from Google AI Studio>`
   - `STATEMENTS_BUCKET` = `<from terraform output>`
   - `AWS_REGION` = `ap-southeast-1`
   - `PDF_PASSWORD` = `<password for protected TPBank statement PDFs>`
   - `AUTH_SECRET` = `<openssl rand -base64 32 / npx auth secret>`
   - `AUTH_GOOGLE_ID` = `<Google OAuth client ID>`
   - `AUTH_GOOGLE_SECRET` = `<Google OAuth client secret>`
   - `ALLOWED_EMAIL` = `<the single allowed Google account email>`
7. **Service role:** create a new one (or pick existing). Note the role name.
8. Save and deploy.

The first build takes 4-8 minutes.

### 4. Attach S3 policy to Amplify service role

The Amplify service role needs S3 access to the statements bucket. Use the policy created in Step 06:

```bash
# Get the policy ARN from Step 06
cd terraform
POLICY_ARN=$(terraform output -raw statements_policy_arn)

# Find the Amplify service role name (from Amplify console → app settings → general)
ROLE_NAME="amplifyconsole-backend-role-xxxxx"

aws iam attach-role-policy \
  --role-name $ROLE_NAME \
  --policy-arn $POLICY_ARN
```

Or, do it in Terraform for full IaC:
```hcl
data "aws_iam_role" "amplify" {
  name = "amplifyconsole-backend-role-xxxxx"
}

resource "aws_iam_role_policy_attachment" "amplify_s3" {
  role       = data.aws_iam_role.amplify.name
  policy_arn = aws_iam_policy.statements_rw.arn
}
```

### 5. Verify production deployment

Visit the Amplify-provided URL (`https://main.xxxxx.amplifyapp.com`):

- Home page loads → see empty state (no statements yet)
- Click "Upload statement" → upload the sample PDF
- Verify it appears in S3 via CLI
- Verify the dashboard renders
- Verify the AI summary streams
- Test on mobile (real device)

### 6. CloudWatch Logs check

Open CloudWatch Logs → find the Amplify SSR log group:
- Look for any error patterns in the first few invocations
- Verify there's no PII in logs (no card numbers, no statement contents)
- If you see anything sensitive, fix the logging immediately and re-deploy

### 7. Custom domain (optional)

If you want `expenses.huy.dev` or similar:

1. **Amplify Console → Domain management → Add domain**
2. If domain is in Route 53: Amplify configures it automatically
3. If domain is elsewhere: Amplify gives you CNAME records to add
4. SSL cert is provisioned automatically via ACM
5. Wait 10-30 minutes for DNS + cert

### 8. Optional: branch deploys for testing

- Push a `develop` branch
- In Amplify Console → connect the branch → it gets its own URL
- Use a different `STATEMENTS_BUCKET` env var (e.g., `expense-tracker-statements-dev-...`) to isolate data

### 9. Monitoring / alerts (light touch)

For personal use, full observability is overkill. But consider:

- **CloudWatch alarm:** alert if Lambda errors exceed 5/hour (catches Gemini quota exhaustion early)
- **Budget alert:** AWS Budgets → email when monthly cost exceeds $5 (catches surprises)

Both are 5 minutes to set up via console, can be Terraform-managed later.

## Files affected

- `amplify.yml` — **create** (in repo root)
- `terraform/iam.tf` — optionally modify (attach policy to Amplify role)
- README — update with deployment URL

## Acceptance criteria

- Amplify build completes without errors
- Production URL loads the home page
- Uploading a statement via production URL writes to S3
- AI summary works in production
- Production logs show no errors and no PII
- Pushing a commit to `main` triggers an auto-deploy
- (If custom domain) HTTPS works at the custom domain

## Notes & gotchas

- **`baseDirectory: .next` is mandatory for Next.js 15.** Amplify Hosting compute requires this regardless of SSG/SSR — this is the #1 mistake when deploying Next.js to Amplify.
- **The Amplify-detected build settings can be wrong.** Always verify the `amplify.yml` it shows matches what's in your repo. If they conflict, the repo file wins.
- **First deploy fails often.** Common causes:
  - Missing env vars → Lambda crashes on first request
  - Wrong region → S3 GETs fail
  - Wrong IAM permissions → S3 PutObject denied
  Check CloudWatch Logs first for any debugging.
- **pnpm version pinning matters.** The `packageManager` field in `package.json` should match what `corepack prepare` installs — keep them in sync.
- **Don't put `GEMINI_API_KEY` in `amplify.yml`** — env vars must be in the Amplify Console (encrypted at rest) or via Secrets Manager for stronger isolation.
- **Cold starts:** the first request after idle takes 1-2 seconds (Lambda init + Next.js boot). Warm requests are sub-200ms. For personal use this is fine.
- **Build minutes are billed after the free tier.** A typical Next.js build is ~5 minutes; at $0.01/min, that's $0.05 per push. Don't trigger builds on every typo.

## Done ✅

If everything above checks out, the app is live and the implementation plan is complete.

What's next (post-deploy):
- Use it for a month, see what's annoying
- Iterate based on real data (more bank parsers? Better categories?)
- Phase 4 (multi-bank) and Phase 5 (budgets/forecasting) from the master plan, if useful

## Reference

- [Master plan](./expense-tracker-implementation-plan.md) — full architecture and rationale
- [Step index](./00-INDEX.md) — all steps
