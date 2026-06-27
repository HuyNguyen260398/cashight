# AWS Architecture Diagrams Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `docs/AWS_ARCHITECTURE_DIAGRAMS.md` with three verified Mermaid diagrams for Cashight's current AWS topology, deployment pipeline, and runtime data flow.

**Architecture:** Separate infrastructure topology from deployment and runtime sequences so DevOps and application engineers can read the level relevant to them. Trace every node and relationship to current Terraform, GitHub Actions, or server-side application code, and leave the existing `docs/codebase/DIAGRAMS.md` unchanged.

**Tech Stack:** Markdown, Mermaid, AWS Amplify Hosting, WAF, Cognito, S3, SSM Parameter Store, IAM/OIDC/STS, CloudWatch/SNS, GitHub Actions, Next.js SSR, Gemini.

---

## File Structure

- Create: `docs/AWS_ARCHITECTURE_DIAGRAMS.md` — user-facing AWS architecture reference and three copy-paste-ready Mermaid scripts.
- Modify: none.

### Task 1: Create the AWS deployment topology

**Files:**

- Create: `docs/AWS_ARCHITECTURE_DIAGRAMS.md`

- [ ] **Step 1: Add the document purpose and evidence boundary**

State that the document represents repository-defined architecture as of
2026-06-27 and is derived from `terraform/`, `.github/workflows/deploy.yaml`,
`amplify.yml`, `auth.ts`, `app/api/`, and the AWS adapters in `lib/`.

- [ ] **Step 2: Add a Mermaid `flowchart TB` topology**

Include these exact boundaries and relationships:

- Global/us-east-1 edge: `cashight.nghuy.link` through the Amplify-managed Route
  53 domain association and the CloudFront-scoped WAF.
- ap-southeast-1 runtime: Amplify `WEB_COMPUTE` main branch and Next.js SSR.
- Authentication: Auth.js uses the Cognito User Pool, Hosted UI, and
  confidential app client.
- Runtime identity: the Amplify compute role grants `statements/*` S3 CRUD,
  bucket listing, and reads of the two named SSM parameters.
- Build identity: the separate Amplify service role provides build/deploy and
  CloudWatch Logs permissions.
- Data: private, AES256-encrypted, versioned `cashight-statements`; encrypted
  `cashight-tfstate` with native S3 lockfile.
- Observability: SSR logs, Amplify Hosting 4xx/5xx/latency alarms, and optional
  SNS email.
- External dependency: Gemini receives privacy-filtered aggregates only.
- Management plane: Terraform stores state in `cashight-tfstate` and provisions
  the repository-managed AWS resources.

Use solid arrows for request/data flow and dashed arrows for IAM, management,
and monitoring relationships. Add distinct Mermaid classes for AWS services,
security controls, data stores, and external actors.

- [ ] **Step 3: Add a topology source map**

Map the topology to `terraform/amplify.tf`, `terraform/cognito.tf`,
`terraform/s3.tf`, `terraform/backend.tf`, `terraform/iam.tf`,
`terraform/waf.tf`, and `terraform/monitoring.tf`.

- [ ] **Step 4: Commit the topology checkpoint**

Run: `git add docs/AWS_ARCHITECTURE_DIAGRAMS.md`

Run: `git commit -m "docs: add AWS deployment topology diagram"`

Expected: one new documentation file committed.

### Task 2: Add deployment and runtime sequences

**Files:**

- Modify: `docs/AWS_ARCHITECTURE_DIAGRAMS.md`

- [ ] **Step 1: Add a Mermaid `sequenceDiagram` for CI/CD**

Show the exact sequence from `.github/workflows/deploy.yaml`: push to `main`;
install, audit, typecheck, lint, build, and test; stop on verification failure;
request a GitHub OIDC token; call STS `AssumeRoleWithWebIdentity`; evaluate the
repository-and-main-branch IAM trust; receive temporary credentials; start an
Amplify `RELEASE` job; run `amplify.yml`; poll `GetJob`; and report the terminal
status.

- [ ] **Step 2: Add a Mermaid `sequenceDiagram` for runtime data and security**

Divide the sequence into four labeled sections:

1. Authentication: Route 53/WAF/Amplify, Auth.js, Cognito authorization-code
   flow, verified-email allowlist, session.
2. Upload: authenticated `/api/parse`, SSM PDF password read, PDF extraction,
   immediate PAN masking, categorization, Zod validation, and S3 persistence at
   `statements/{last4}/{year}/{year}-{mm}.json`.
3. Dashboard: authenticated dynamic SSR, S3 list/get, schema validation, pure
   period aggregation, rendered response.
4. AI summary: authenticated `/api/summarize`, SSM Gemini key read, Zod
   validation, aggregate-only payload shaping, Gemini streaming response.

End with dashed operational relationships from the SSR runtime to CloudWatch
Logs and from Amplify Hosting metrics to CloudWatch.

- [ ] **Step 3: Add source maps and alternative formats**

Map CI/CD to `.github/workflows/deploy.yaml`, `terraform/github-oidc.tf`, and
`amplify.yml`. Map runtime flow to `auth.ts`, `app/api/parse/route.ts`,
`app/api/summarize/route.ts`, `lib/storage.ts`, `lib/server-secrets.ts`, and
`lib/summary-payload.ts`.

List three alternatives without generating assets: C4 deployment/container
diagrams for governance; diagrams.net or Cloudcraft with AWS icons for
presentations; Python Diagrams or Graphviz for code-generated SVG/PNG output.

- [ ] **Step 4: Commit the complete diagram set**

Run: `git add docs/AWS_ARCHITECTURE_DIAGRAMS.md`

Run: `git commit -m "docs: add AWS deployment and runtime flow diagrams"`

Expected: the same documentation file now contains all three Mermaid scripts.

### Task 3: Verify the Mermaid scripts and repository scope

**Files:**

- Verify: `docs/AWS_ARCHITECTURE_DIAGRAMS.md`

- [ ] **Step 1: Scan for speculative services and sensitive values**

Run: `rg -n "API Gateway|DynamoDB|GEMINI_API_KEY=|PDF_PASSWORD=" docs/AWS_ARCHITECTURE_DIAGRAMS.md`

Expected: no output. Privacy labels such as `No PAN` are allowed; no secret
values, full PAN, names, or raw transaction descriptions may appear.

- [ ] **Step 2: Render all embedded Mermaid blocks**

Run: `pnpm dlx @mermaid-js/mermaid-cli@11.12.0 mmdc -i docs/AWS_ARCHITECTURE_DIAGRAMS.md -o /tmp/cashight-aws-architecture-rendered.md`

Expected: exit code 0 and three rendered assets referenced by the temporary
Markdown output. Generated files remain outside the repository.

- [ ] **Step 3: Check formatting and resource coverage**

Run: `git diff --check main...HEAD`

Run: `rg -n '^resource "aws_|^data "aws_iam_openid_connect_provider"' terraform`

Run: `rg -n 'Amplify|WAF|Cognito|S3|SSM|CloudWatch|SNS|OIDC|STS' docs/AWS_ARCHITECTURE_DIAGRAMS.md`

Expected: no formatting errors; every user-facing service and supporting
identity, data, secrets, monitoring, and deployment service is documented.
Low-level bucket controls and individual IAM policy statements are summarized
under their parent services rather than drawn as independent architecture nodes.

- [ ] **Step 4: Confirm the branch is clean**

Run: `git status --short --branch`

Expected: `codex/aws-architecture-diagrams` has no uncommitted changes.
