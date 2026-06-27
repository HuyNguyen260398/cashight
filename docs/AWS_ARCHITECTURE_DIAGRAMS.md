# Current AWS Architecture Diagrams

These diagrams describe the AWS architecture defined by the repository as of
2026-06-27. They are intended for DevOps and application engineers and are
copy-paste-ready for Mermaid-aware Markdown renderers.

The diagrams distinguish repository-defined infrastructure from external
services and manually provisioned runtime secrets. They do not claim that every
optional resource is enabled in every environment.

## 1. AWS deployment topology

This view shows the runtime, management, security, data, and observability
boundaries. Solid arrows represent request or data flow. Dashed arrows represent
identity, provisioning, or monitoring relationships.

```mermaid
flowchart TB
    user([User / Browser])
    engineer([DevOps Engineer])
    terraform["Terraform CLI<br/>AWS provider"]
    github["GitHub repository<br/>HuyNguyen260398/cashight"]

    subgraph external["External services"]
        google["Google OAuth<br/>alternate Auth.js provider"]
        gemini["Google Gemini API<br/>anonymized aggregates only"]
    end

    subgraph aws["AWS Account"]
        subgraph edge["Global edge / us-east-1 provider"]
            dns["Route 53 DNS<br/>managed by Amplify domain association<br/>cashight.nghuy.link"]
            waf["AWS WAF v2<br/>CloudFront scope<br/>managed rules + rate limit"]
        end

        subgraph region["ap-southeast-1"]
            amplify["AWS Amplify Hosting<br/>WEB_COMPUTE / main branch"]
            app["Next.js 16 SSR runtime<br/>server components + Node.js API routes"]
            auth["Auth.js v5<br/>session + email allowlist"]
            cognito["Amazon Cognito<br/>User Pool + Hosted UI + app client"]

            compute["IAM Amplify compute role<br/>request-time identity"]
            service["IAM Amplify service role<br/>build/deploy identity"]

            statements[("S3 cashight-statements<br/>private + AES256 + versioned")]
            tfstate[("S3 cashight-tfstate<br/>encrypted state + native lockfile")]
            ssm["SSM Parameter Store<br/>GEMINI_API_KEY + PDF_PASSWORD<br/>SecureString parameters"]

            logs["CloudWatch Logs<br/>Amplify SSR logs"]
            alarms["CloudWatch alarms<br/>5xx + 4xx + latency"]
            sns["SNS email notification<br/>optional"]

            deployRole["IAM GitHub deploy role<br/>main branch trust"]
            oidc["GitHub OIDC provider<br/>account-level"]
        end
    end

    user -->|HTTPS| dns --> waf --> amplify --> app
    app --> auth
    auth <-->|OIDC authorization code| cognito
    auth <-->|OAuth| google
    app -->|statements prefix CRUD| statements
    app -->|GetParameter with decryption| ssm
    app -->|privacy-filtered prompt| gemini

    compute -.->|assigned runtime identity| app
    compute -.->|scoped S3 policy| statements
    compute -.->|scoped parameter reads| ssm
    service -.->|build/deploy role| amplify
    service -.->|log publishing policy| logs

    amplify -.->|SSR operational logs| logs
    amplify -.->|AWS/AmplifyHosting metrics| alarms
    alarms -->|when enabled and email configured| sns

    github -.->|signed identity token| oidc
    oidc -.->|AssumeRoleWithWebIdentity| deployRole
    deployRole -.->|StartJob + GetJob + ListJobs| amplify

    engineer --> terraform
    terraform -->|state + locking| tfstate
    terraform -.->|provisions and configures| amplify
    terraform -.->|provisions| cognito
    terraform -.->|provisions| statements
    terraform -.->|provisions| waf
    terraform -.->|provisions| alarms

    classDef awsService fill:#fff3e0,stroke:#e65100,color:#3e2723;
    classDef security fill:#ffebee,stroke:#c62828,color:#3e2723;
    classDef data fill:#e8f5e9,stroke:#2e7d32,color:#1b5e20;
    classDef externalNode fill:#e3f2fd,stroke:#1565c0,color:#0d47a1;

    class amplify,app,auth,cognito,logs,alarms,sns awsService;
    class waf,compute,service,ssm,deployRole,oidc security;
    class statements,tfstate data;
    class user,engineer,terraform,github,google,gemini,dns externalNode;
```

Important IAM distinction:

- The Amplify **service role** is used for build/deploy and log publishing.
- The Amplify **compute role** is the request-time identity used by Next.js SSR
  to access S3 and SSM.
- The GitHub **deploy role** is assumed through OIDC and can only control
  Amplify release jobs for this application.

## 2. CI/CD deployment sequence

This view follows `.github/workflows/deploy.yaml`. The workflow verifies the
application before obtaining AWS credentials or triggering production.

```mermaid
sequenceDiagram
    actor Dev as Developer
    participant GH as GitHub Actions
    participant Verify as Verify job
    participant OIDC as GitHub OIDC provider
    participant STS as AWS STS
    participant IAM as IAM deploy role
    participant Amp as AWS Amplify
    participant Build as Amplify build environment

    Dev->>GH: Push commit to main
    GH->>Verify: Install dependencies
    Verify->>Verify: Audit, typecheck, lint, build, test

    alt Verification fails
        Verify-->>GH: Failed
        GH-->>Dev: Stop before deployment
    else Verification passes
        Verify-->>GH: Passed
        GH->>OIDC: Request signed identity token
        OIDC-->>GH: Token for repository main branch
        GH->>STS: AssumeRoleWithWebIdentity(token)
        STS->>IAM: Evaluate OIDC trust policy
        IAM-->>STS: Allow repository main branch
        STS-->>GH: Temporary AWS credentials

        GH->>Amp: StartJob(RELEASE, branch=main)
        Amp->>Build: Fetch main and run amplify.yml
        Build->>Build: pnpm install and pnpm build
        Build-->>Amp: Publish Next.js SSR artifact

        loop Until terminal status
            GH->>Amp: GetJob(jobId)
            Amp-->>GH: PENDING / RUNNING / SUCCEED / FAILED
        end

        Amp-->>GH: SUCCEED
        GH-->>Dev: Production deployment succeeded
    end
```

Security properties represented above:

- GitHub receives short-lived AWS credentials; no long-lived AWS key is needed.
- The IAM trust policy is restricted to `HuyNguyen260398/cashight` on `main`.
- The deploy job cannot start until lint, build, type checking, audit, and tests
  complete successfully.
- Amplify native auto-build is disabled, keeping GitHub Actions as the sole
  production deployment trigger.

## 3. Runtime data and security flow

This sequence combines authentication, PDF processing, dashboard rendering, and
AI summarization. It highlights where secrets and sensitive financial data are
constrained.

```mermaid
sequenceDiagram
    actor User
    participant Edge as Route 53 / WAF / Amplify
    participant App as Next.js SSR + API routes
    participant Auth as Auth.js session guard
    participant Cognito as Amazon Cognito
    participant SSM as SSM Parameter Store
    participant Parser as TPBank parser + Zod
    participant S3 as S3 statements bucket
    participant Gemini as Google Gemini
    participant CW as CloudWatch

    rect rgb(245, 248, 255)
        Note over User,Cognito: Cognito authentication path
        User->>Edge: Open cashight.nghuy.link
        Edge->>App: HTTPS request
        App->>Auth: requireSession()
        Auth->>Cognito: OIDC authorization-code flow
        Cognito-->>Auth: Verified identity claims
        Auth->>Auth: Enforce verified-email allowlist
        Auth-->>App: Authenticated session
    end

    rect rgb(255, 248, 245)
        Note over User,S3: PDF upload and persistence
        User->>Edge: POST /api/parse with PDF
        Edge->>App: Forward to Node.js route
        App->>Auth: requireApiSessionWithUser()
        Auth-->>App: Authenticated session
        App->>SSM: GetParameter(PDF_PASSWORD, decrypt=true)
        SSM-->>App: Runtime secret
        App->>Parser: Parse PDF buffer
        Parser->>Parser: Extract, mask PAN, categorize, validate
        Parser-->>App: Validated Statement with cardLast4 only
        App->>S3: Check key and PutObject
        Note over App,S3: statements/{last4}/{year}/{year}-{mm}.json
        S3-->>App: Stored with versioning
        App-->>User: Parsed statement response
    end

    rect rgb(245, 255, 248)
        Note over User,S3: Server-rendered dashboard
        User->>Edge: GET /?period=...
        Edge->>App: Dynamic SSR request
        App->>Auth: requireSession()
        Auth-->>App: Authenticated session
        App->>S3: ListObjects and parallel GetObject
        S3-->>App: Stored statement JSON
        App->>App: Zod validate and aggregate selected period
        App-->>User: Rendered dashboard
    end

    rect rgb(252, 245, 255)
        Note over User,Gemini: Privacy-preserving AI summary
        User->>Edge: POST /api/summarize with AggregatedView
        Edge->>App: Forward request
        App->>Auth: requireApiSessionWithUser()
        Auth-->>App: Authenticated session
        App->>SSM: GetParameter(GEMINI_API_KEY, decrypt=true)
        SSM-->>App: Runtime secret
        App->>App: Zod validate and build safe summary payload
        Note over App,Gemini: No PAN, names, or raw transaction descriptions
        App->>Gemini: Totals, top categories, and top merchants
        Gemini-->>App: Streaming summary
        App-->>User: ReadableStream response
    end

    App-->>CW: Redacted operational logs
    Edge-->>CW: Amplify Hosting metrics
```

The Google OAuth provider is an alternate sign-in path. The sequence uses
Cognito because it shows the AWS-native authentication flow.

## Source map

| Concern | Repository evidence |
| --- | --- |
| Amplify app, roles, branch, custom domain | `terraform/amplify.tf` |
| Cognito User Pool, Hosted UI, app client | `terraform/cognito.tf` |
| Statements storage controls | `terraform/s3.tf`, `lib/storage.ts` |
| Terraform remote state | `terraform/backend.tf` |
| Runtime S3 and SSM permissions | `terraform/iam.tf` |
| GitHub OIDC deployment role | `terraform/github-oidc.tf` |
| CloudFront-scoped WAF | `terraform/waf.tf` |
| CloudWatch alarms and optional SNS | `terraform/monitoring.tf` |
| Deployment gates and release trigger | `.github/workflows/deploy.yaml` |
| Amplify build and runtime env propagation | `amplify.yml` |
| Authentication and allowlist | `auth.ts`, `lib/require-session.ts` |
| Upload and privacy boundaries | `app/api/parse/route.ts`, `lib/parsers/tpbank.ts` |
| AI aggregate-only boundary | `app/api/summarize/route.ts`, `lib/summary-payload.ts` |

## Other diagram options

| Format | Best use | Trade-off |
| --- | --- | --- |
| C4 context/container/deployment | Architecture governance and onboarding | Clear boundaries, but less AWS-resource detail |
| diagrams.net with official AWS icons | Presentations and stakeholder reviews | Strong visual polish, but manual updates can drift |
| Cloudcraft | AWS cost and topology discussions | AWS-focused and visual, but usually maintained outside Git |
| Python Diagrams | Reproducible SVG/PNG generation | Code-reviewable, but adds Python and Graphviz dependencies |
| Graphviz DOT | Precise automated graph layout | Powerful, but less approachable than Mermaid |

For this repository, Mermaid is the best default because the source remains
reviewable beside Terraform and renders directly in common Markdown tooling.
