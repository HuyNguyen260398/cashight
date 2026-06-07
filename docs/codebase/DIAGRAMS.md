# Architecture Diagrams

Mermaid source for the Cashight architecture. Each block is independently
copy-paste-ready into [mermaid.live](https://mermaid.live) or any Mermaid-aware
renderer (GitHub, Obsidian, VS Code Mermaid preview).

## 1. System architecture (flowchart)

```mermaid
flowchart TB
    user([User / Browser])

    subgraph client["Client (React 19)"]
        upload["upload-dropzone.tsx"]
        dash["Dashboard + charts<br/>(recharts)"]
        aicard["ai-summary-card.tsx"]
    end

    subgraph auth_layer["Auth (next-auth v5)"]
        authcfg["auth.ts<br/>allowlist gate"]
        guard["require-session.ts<br/>requireSession / requireApiSession"]
        allow["auth-allowlist.ts"]
    end

    subgraph routes["API Routes (runtime = nodejs)"]
        parse["/api/parse<br/>force-dynamic"]
        summarize["/api/summarize"]
        statements["/api/statements<br/>+ /[id]"]
        nextauth["/api/auth/[...nextauth]"]
    end

    subgraph page["Server Component"]
        home["app/page.tsx<br/>reads searchParams (period)"]
    end

    subgraph domain["Domain logic (lib/, pure)"]
        parser["parsers/tpbank.ts<br/>regex + mask PAN"]
        categorize["categorize.ts"]
        schemas["schemas.ts<br/>Zod boundary"]
        agg["aggregations.ts<br/>dashboard-aggregations.ts"]
        period["period.ts<br/>PeriodSpec"]
        payload["summary-payload.ts<br/>anonymize"]
    end

    subgraph io["I/O adapters"]
        storage["storage.ts<br/>S3 client (lazy)"]
        gemini["gemini.ts<br/>stream"]
    end

    subgraph ext["External (ap-southeast-1)"]
        s3[("AWS S3<br/>statements/{last4}/{yr}/{yr}-{mm}.json")]
        gem["Google Gemini<br/>2.5-flash"]
        idp["Google / Cognito OAuth"]
    end

    user --> upload --> parse
    user --> home
    user --> aicard --> summarize
    dash -.->|delete/list| statements

    parse --> guard
    summarize --> guard
    statements --> guard
    home --> guard
    guard --> authcfg --> allow
    nextauth --> authcfg
    authcfg --> idp

    parse --> parser --> categorize
    parser --> schemas
    parse --> storage

    home --> storage
    home --> agg
    agg --> period
    home --> dash

    summarize --> schemas
    summarize --> payload --> gemini

    storage --> s3
    gemini --> gem

    classDef pci fill:#ffe6e6,stroke:#c0392b;
    classDef pure fill:#e8f5e9,stroke:#2e7d32;
    class parser,payload pci;
    class categorize,schemas,agg,period pure;
```

> Red nodes = PCI boundary (PAN masked / aggregates anonymized). Green = pure, side-effect-free modules.

## 2. Upload & parse flow (sequence)

```mermaid
sequenceDiagram
    actor U as User
    participant R as /api/parse
    participant G as require-session
    participant P as parsers/tpbank.ts
    participant Z as StatementSchema (Zod)
    participant S as storage.ts
    participant S3 as AWS S3

    U->>R: POST file (multipart)
    R->>G: requireApiSession()
    alt not authenticated
        G-->>U: 401 JSON
    end
    R->>R: validate MIME + size (<=5MB)
    R->>P: parseTPBankStatement(buffer, PDF_PASSWORD)
    P->>P: pdf-parse extract text
    P->>P: mask PAN -> cardLast4
    P->>Z: StatementSchema.parse()
    Z-->>P: validated Statement
    P-->>R: Statement
    R->>S: statementExists(key)?
    alt exists and not force
        S-->>U: 409 conflict
    end
    R->>S: saveStatement()
    S->>S3: PUT object
    S3-->>S: ok
    R-->>U: 200 Statement JSON
```

## 3. Dashboard render & AI summary (sequence)

```mermaid
sequenceDiagram
    actor U as User
    participant H as app/page.tsx (SSR)
    participant S as storage.ts
    participant S3 as AWS S3
    participant A as aggregations.ts
    participant C as AI summary (client)
    participant SUM as /api/summarize
    participant PL as summary-payload.ts
    participant GM as Gemini

    U->>H: GET /?period=month&year=2026&month=5
    H->>H: requireSession() (redirect if unauth)
    H->>S: getAllStatements()
    S->>S3: LIST + parallel GET
    S3-->>S: Statement[]
    H->>A: aggregate(statements, periodSpec)
    A-->>H: AggregatedView
    H-->>U: rendered Dashboard

    U->>C: open AI summary card
    C->>SUM: POST AggregatedView
    SUM->>SUM: AggregatedViewSchema.safeParse()
    SUM->>PL: buildSummaryPayload() (strip PII)
    PL-->>SUM: anonymized aggregates
    SUM->>GM: streamSummary(prompt)
    GM-->>U: text stream (ReadableStream)
```
