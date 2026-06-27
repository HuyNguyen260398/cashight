# AWS Architecture Diagrams Design

## Goal

Document Cashight's current AWS architecture for both DevOps and application
engineers using copy-paste-ready Mermaid scripts. The diagrams must describe the
deployed design found in Terraform and the real application data paths, without
inventing unprovisioned services.

## Sources of Truth

- `terraform/amplify.tf`, `terraform/cognito.tf`, `terraform/s3.tf`
- `terraform/iam.tf`, `terraform/github-oidc.tf`
- `terraform/monitoring.tf`, `terraform/waf.tf`
- `.github/workflows/deploy.yaml`, `docs/DEPLOYMENT.md`
- `app/api/`, `auth.ts`, `lib/storage.ts`, `lib/server-secrets.ts`

## Deliverable

Extend `docs/codebase/DIAGRAMS.md` with three independently renderable Mermaid
diagrams while preserving the existing application-level diagrams.

### 1. AWS Deployment Topology

A flowchart will show:

- Users reaching `cashight.nghuy.link` through the Route 53/Amplify-managed
  custom domain and CloudFront-scoped AWS WAF.
- AWS Amplify Hosting serving the Next.js SSR application.
- Cognito providing OIDC authentication through Auth.js.
- The Amplify compute role granting scoped access to the statements S3 bucket
  and two SSM SecureString parameters.
- The separate Amplify service role granting CloudWatch Logs publishing.
- Amplify Hosting metrics feeding three CloudWatch alarms and optional SNS email.
- Regional boundaries: WAF in `us-east-1`; application resources in
  `ap-southeast-1`.
- Gemini as an external, non-AWS dependency receiving anonymized aggregates only.

### 2. CI/CD Deployment Sequence

A sequence diagram will show:

1. A push to `main` starts GitHub Actions.
2. Lint, build, and tests gate deployment.
3. GitHub Actions requests an OIDC token.
4. AWS STS validates the token against the account-level GitHub OIDC provider.
5. The workflow assumes the repository- and branch-scoped deploy role.
6. The role starts and polls an Amplify `RELEASE` job for the `main` branch.
7. Amplify builds from `amplify.yml` and publishes the SSR deployment.

### 3. Runtime Data and Security Flow

A sequence diagram will combine the main application paths without exposing PII:

- Cognito sign-in and Auth.js session enforcement.
- PDF upload to the Node.js `/api/parse` route.
- SSM reads for the PDF password and Gemini API key.
- Immediate PAN masking, categorization, Zod validation, and S3 persistence.
- Server-rendered dashboard reads from S3 through the Amplify compute role.
- AI summaries sending anonymized aggregate payloads to Gemini.
- CloudWatch receiving operational logs and Amplify Hosting metrics.

## Diagram Conventions

- Solid arrows represent request or data flow.
- Dashed arrows represent identity, policy, or monitoring relationships.
- AWS account and regional subgraphs make trust and deployment boundaries visible.
- Labels use service names first and implementation details second.
- Security notes explicitly distinguish the Amplify build service role from the
  SSR compute role.
- Optional resources are marked as optional rather than shown as always active.

## Validation

- Check every node and relationship against current Terraform or runtime code.
- Confirm all Mermaid blocks are syntactically renderable.
- Confirm no secrets, full card numbers, raw descriptions, or personal data appear.
- Review the final diff to ensure existing diagrams are preserved.

## Out of Scope

- Changing AWS resources or Terraform.
- Claiming live deployment state beyond what the repository defines.
- Generating PNG/SVG exports in this change.
- Adding speculative services such as API Gateway, DynamoDB, or standalone Lambda
  functions that are not part of the current architecture.
