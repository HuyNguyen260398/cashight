# Architecture Diagrams

Mermaid source for the Cashight architecture after Phase 9 DNS cutover (2026-06-29).
Each block is independently copy-paste-ready into [mermaid.live](https://mermaid.live)
or any Mermaid-aware renderer (GitHub, Obsidian, VS Code Mermaid preview).

> **Migration history**: the application previously ran as an Amplify SSR WEB_COMPUTE
> deployment. For the complete migration story see
> [`docs/plans/29-hybrid-serverless-migration.md`](../plans/29-hybrid-serverless-migration.md).

## 1. System architecture (flowchart)

```mermaid
flowchart TB
    user([User / Browser])

    subgraph spa["Static SPA (Next.js export, served from CloudFront/S3)"]
        auth_provider["AuthProvider\noidc-client-ts PKCE"]
        api_client["API client\nBearer token → api.cashight.nghuy.link"]
        upload["upload-dropzone.tsx\nSHA-256 + presigned PUT"]
        dash["Dashboard + charts\n(recharts, client component)"]
        aicard["ai-summary-card.tsx\nReadableStream"]
    end

    subgraph edge["Edge (CloudFront + WAF)"]
        cf["CloudFront\ncashight.nghuy.link"]
        s3fe[("S3 frontend\nstatic assets")]
    end

    subgraph apigw["API Gateway (api.cashight.nghuy.link)"]
        cognito_authz["Cognito authorizer\ncashight/read or cashight/write scope"]
        routes_api["Routes"]
    end

    subgraph lambdas["Lambda functions"]
        uploads_api["uploads-api\nPresigned URL + DDB job"]
        upload_status["upload-status-api\nOwned job reads"]
        parser_worker["parser-worker\nSQS consumer\npdf → Statement → S3"]
        statements_api["statements-api\nList + delete"]
        dashboard_api["dashboard-api\nPeriod aggregation"]
        summary_api["summary-api\nStreaming Gemini"]
        auth_guard["auth-guard\nCognito trigger"]
    end

    subgraph domain["packages/domain (pure, shared)"]
        parser["parsers/tpbank.ts\nregex + mask PAN"]
        categorize["categorize.ts"]
        schemas["schemas.ts\nZod boundary"]
        agg["aggregations.ts\ndashboard-aggregations.ts"]
        period["period.ts\nPeriodSpec"]
        payload["summary-payload.ts\nanonymize"]
    end

    subgraph data["Data stores"]
        dynamo[("DynamoDB\nmetadata + jobs + authz")]
        s3st[("S3 statements\nusers/{sub}/statements/...")]
        s3up[("S3 uploads\ntemp PDFs")]
        sqs["SQS parse-queue + DLQ"]
        secrets["Secrets Manager\nGemini key + PDF password"]
    end

    subgraph ext["External services"]
        cognito_idp["Amazon Cognito\nUser Pool + Google IdP"]
        gemini["Google Gemini 2.5 Flash"]
    end

    user --> cf --> s3fe
    user --> auth_provider --> cognito_idp --> auth_guard --> dynamo

    user --> api_client --> apigw
    apigw --> cognito_authz --> routes_api

    routes_api --> uploads_api --> dynamo
    routes_api --> upload_status --> dynamo
    routes_api --> statements_api --> dynamo
    routes_api --> statements_api --> s3st
    routes_api --> dashboard_api --> dynamo
    routes_api --> dashboard_api --> s3st
    routes_api --> summary_api --> dynamo
    routes_api --> summary_api --> s3st
    routes_api --> summary_api --> secrets
    summary_api --> payload --> gemini

    upload --> api_client
    upload --> s3up
    s3up --> sqs --> parser_worker
    parser_worker --> secrets
    parser_worker --> s3up
    parser_worker --> s3st
    parser_worker --> dynamo

    parser_worker --> parser --> categorize
    parser_worker --> schemas
    dashboard_api --> agg --> period

    dash -.->|delete/list| api_client
    aicard -.->|stream| api_client

    classDef pci fill:#ffe6e6,stroke:#c0392b;
    classDef pure fill:#e8f5e9,stroke:#2e7d32;
    classDef edge fill:#e3f2fd,stroke:#1565c0;
    class parser,payload pci;
    class categorize,schemas,agg,period pure;
    class cf,s3fe edge;
```

> Red nodes = PCI boundary (PAN masked / aggregates anonymized). Green = pure,
> side-effect-free modules. Blue = CloudFront edge.

## 2. Upload & async parse flow (sequence)

```mermaid
sequenceDiagram
    actor U as User (browser)
    participant SPA as SPA upload-dropzone
    participant APIGW as API Gateway
    participant UploadsAPI as uploads-api Lambda
    participant S3up as S3 uploads
    participant SQS as SQS parse-queue
    participant Parser as parser-worker Lambda
    participant SM as Secrets Manager
    participant Z as StatementSchema (Zod)
    participant S3st as S3 statements
    participant DDB as DynamoDB

    U->>SPA: Drop PDF (≤5 MiB)
    SPA->>SPA: SHA-256 digest (crypto.subtle)
    SPA->>APIGW: POST /uploads {fileName, sha256, size}
    APIGW->>UploadsAPI: event (Cognito claims)
    UploadsAPI->>UploadsAPI: Validate request (Zod)
    UploadsAPI->>DDB: PutItem PENDING_UPLOAD job (7-day TTL)
    UploadsAPI-->>SPA: {jobId, upload: {url, method, headers, expiresAt}}

    SPA->>S3up: PUT PDF (presigned, exact checksum, 5-min expiry)
    S3up->>SQS: S3 event notification

    loop Poll GET /uploads/{jobId}
        SPA->>APIGW: GET /uploads/{jobId}
        APIGW-->>SPA: {state: PENDING_UPLOAD | PROCESSING | ...}
    end

    SQS->>Parser: Receive message (batch=1)
    Parser->>SM: GetSecretValue(pdf-password)
    Parser->>S3up: GetObject(PDF)
    Parser->>Parser: Validate magic bytes + size
    Parser->>Parser: parseTPBankStatement(buffer, password)
    Note over Parser: PAN masked to cardLast4 here
    Parser->>Z: StatementSchema.parse()
    Z-->>Parser: validated Statement

    alt Conflict (key exists, force=false)
        Parser->>DDB: PROCESSING → CONFLICT
        Parser->>S3up: DeleteObject(PDF)
        Parser-->>SQS: success (terminal)
    else Success
        Parser->>S3st: PutObject statement JSON
        Parser->>DDB: PROCESSING → SUCCEEDED (conditional)
        Parser->>S3up: DeleteObject(PDF)
        Parser-->>SQS: success
    else Retryable infra error
        Parser-->>SQS: batchItemFailures (retry)
    end

    SPA->>APIGW: GET /uploads/{jobId}
    APIGW-->>SPA: {state: SUCCEEDED | CONFLICT | FAILED}
```

## 3. Dashboard render & AI summary (sequence)

```mermaid
sequenceDiagram
    actor U as User (browser)
    participant SPA as SPA Dashboard (client component)
    participant APIGW as API Gateway
    participant DashAPI as dashboard-api Lambda
    participant DDB as DynamoDB
    participant S3 as S3 statements
    participant A as aggregations.ts
    participant SumAPI as summary-api Lambda (streaming)
    participant PL as summary-payload.ts
    participant SM as Secrets Manager
    participant GM as Gemini 2.5 Flash

    U->>SPA: Navigate to /?period=month&year=2026&month=5
    Note over SPA: Reads period from URL (useSearchParams)
    SPA->>APIGW: GET /dashboard?period=month&year=2026&month=5
    APIGW->>DashAPI: event (Cognito claims)
    DashAPI->>DDB: Query USER#{sub} STATEMENT# (period range)
    DashAPI->>S3: Parallel GetObject (concurrency 5)
    S3-->>DashAPI: Statement JSON (Zod validated)
    DashAPI->>A: aggregate(statements, periodSpec)
    A-->>DashAPI: AggregatedView
    DashAPI-->>SPA: AggregatedView JSON
    SPA->>SPA: Render charts/KPI cards/table

    U->>SPA: Open AI summary card
    SPA->>APIGW: GET /summaries?period=month&year=2026&month=5
    APIGW->>SumAPI: event (Cognito claims, streaming mode)
    SumAPI->>DDB: Query metadata for period
    SumAPI->>S3: Fetch statement objects
    SumAPI->>PL: buildSummaryPayload()
    Note over PL: Strips to totals/top categories/top merchants
    Note over PL: No PAN, names, or raw transaction descriptions
    PL-->>SumAPI: anonymized SafeSummaryPayload
    SumAPI->>SM: GetSecretValue(gemini-api-key)
    SumAPI->>GM: Streaming prompt (text/event-stream)
    GM-->>U: ReadableStream via API Gateway response streaming
```

## 4. Authentication flow (sequence)

```mermaid
sequenceDiagram
    actor U as User (browser)
    participant SPA as SPA (AuthProvider)
    participant Cognito as Amazon Cognito (Hosted UI)
    participant Google as Google OAuth
    participant Guard as auth-guard Lambda
    participant DDB as DynamoDB

    U->>SPA: Click "Sign in with Cognito" or "Sign in with Google"

    alt Cognito native
        SPA->>Cognito: Authorization request + PKCE challenge
        Cognito->>U: Hosted UI login form
        U->>Cognito: Credentials
    else Google federation
        SPA->>Cognito: Authorization request + identity_provider=Google
        Cognito->>Google: OAuth redirect
        Google->>U: Google consent screen
        U->>Google: Approve
        Google-->>Cognito: Google tokens
    end

    Cognito->>Guard: PreSignUp_ExternalProvider (first sign-up)
    Guard->>Guard: Enforce ALLOWED_EMAIL
    alt Email not allowed
        Guard-->>Cognito: AccessDenied
        Cognito-->>U: Sign-in error
    end

    Cognito->>Guard: PreTokenGeneration (every token issuance)
    Guard->>DDB: Upsert AUTHZ#{sub}/PROFILE (active=true)
    Guard-->>Cognito: Allow

    Cognito-->>SPA: Authorization code
    SPA->>Cognito: Token exchange (code + PKCE verifier)
    Cognito-->>SPA: Access token (1 h) + ID token + refresh token (7 d)
    SPA->>SPA: Store in sessionStorage
    SPA->>SPA: Attach Bearer token to API requests
    SPA->>U: Redirect to dashboard
```
