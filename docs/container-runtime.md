# Container runtime

The backend handlers in `backend/functions/` run either as Lambdas or as
containers. `pnpm build:servers` bundles four container entrypoints into
`dist/servers/`, and the root `Dockerfile` packages them into one image.

## Workloads

| Workload | Container args | Serves |
|---|---|---|
| `cashight-api` | `/app/api/index.js` (default) | `/uploads`, `/statements`, `/dashboard`, `/session/capabilities`, `/summaries` |
| `cashight-aws-api` | `/app/aws-api/index.js` | `/aws/cost-explorer/*`, `/aws/invoices/*` |
| `cashight-parser-worker` | `/app/parser-worker/index.js` | the statement parse queue |
| `cashight-invoice-parser-worker` | `/app/invoice-parser-worker/index.js` | the invoice parse queue |

An ingress must send `/aws/*` to `cashight-aws-api` and everything else to
`cashight-api`. Each API answers 404 for the other's routes.

## Probes (API workloads)

| Path | Use |
|---|---|
| `GET /healthz` | Liveness. Always 200 while the process runs. |
| `GET /readyz` | Readiness. 503 from SIGTERM until exit. |
| `GET /health` | Public health check, same body the API Gateway mock returned. |

Workers expose no port. A worker that cannot make progress exits and is restarted.

## Environment

### All workloads

| Variable | Required | Notes |
|---|---|---|
| `STORAGE_REGION` or `AWS_REGION` | no | Defaults to `ap-southeast-1` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | no | OTLP/HTTP base URL, e.g. `http://otel-gateway.observability:4318`. Unset disables export. |
| `APP_VERSION` | no | Reported as `service.version`; set it to the image digest or commit SHA |
| `ENABLE_LEGACY_WORKSPACE_FALLBACK`, `ENABLE_LEGACY_AUTHZ_FALLBACK` | no | Same meaning as on the Lambdas |

### API workloads

| Variable | Required | Notes |
|---|---|---|
| `COGNITO_USER_POOL_ID` | yes | `terraform output` user pool id |
| `COGNITO_CLIENT_IDS` | yes | Comma-separated app client ids allowed to call the API (SPA client, smoke client) |
| `ALLOWED_ORIGIN` | no | The single browser origin allowed by CORS. Default `https://cashight.nghuy.link`. Must be one https origin with no path, trailing slash, port 443, wildcard or list; anything else stops the process at startup. See "Hostnames and rollout". |
| `PORT` | no | Default `8080` |
| `RATE_LIMIT_BURST`, `RATE_LIMIT_PER_SECOND` | no | Defaults `50` and `100`, per pod |
| `SHUTDOWN_DELAY_MS` | no | Default `5000`. Drain time after readiness fails. |

| Workload | Also requires |
|---|---|
| `cashight-api` | `TABLE_NAME`, `STATEMENTS_BUCKET`, `UPLOAD_BUCKET`, `GEMINI_PARAM` |
| `cashight-aws-api` | `TABLE_NAME`, `STATEMENTS_BUCKET`, `UPLOAD_BUCKET`, `EXPORT_BUCKET`, `GEMINI_PARAM`; optional `GRANULAR_DATA_ENABLED` |

### Worker workloads

| Variable | Required | Notes |
|---|---|---|
| `QUEUE_URL` | yes | The queue this worker consumes |
| `MAX_PROCESSING_SECONDS` | yes | Per-job limit; must be below the 360 s visibility timeout. `120` for the statement parser, `300` for the invoice parser. |
| `TABLE_NAME`, `STATEMENTS_BUCKET`, `UPLOAD_BUCKET` | yes | |
| `PDF_PASSWORD_PARAM` | statement parser only | SSM parameter name |

Set the pod's `terminationGracePeriodSeconds` above `MAX_PROCESSING_SECONDS` for
workers, and above `SHUTDOWN_DELAY_MS` for APIs, so a rollout never cuts off
work in progress.

AWS credentials come from the SDK default chain (EKS Pod Identity in the
cluster). Secrets are read from SSM at runtime; no secret is passed by
environment variable.

## Hostnames and rollout

The container stack is rolled out beside the Lambda stack on its own hostname,
then takes over the production name once the Lambda stack is retired. No
hostname is compiled into the image except the default origin, so each stage
is a configuration change.

| Stage | Frontend origin | API hostname | `ALLOWED_ORIGIN` on both API workloads |
|---|---|---|---|
| Parallel run and soak | `https://cashight-v2.nghuy.link` | `api.cashight-v2.nghuy.link` | `https://cashight-v2.nghuy.link` |
| After the rename | `https://cashight.nghuy.link` | `api.cashight.nghuy.link` | unset, or `https://cashight.nghuy.link` |

Each deployment allows exactly one origin (SEC-006). The Lambdas never set
`ALLOWED_ORIGIN` and keep answering for `https://cashight.nghuy.link`.

At the rename, the frontend build (`NEXT_PUBLIC_API_BASE_URL`,
`NEXT_PUBLIC_APP_ORIGIN`), the DNS records and `ALLOWED_ORIGIN` must change
together: a browser on one origin calling an API that allows the other gets a
CORS failure on every request. The same Cognito user pool serves both stages,
so `COGNITO_USER_POOL_ID` does not change; add the v2 app client id to
`COGNITO_CLIENT_IDS` only if the v2 frontend gets its own client.

## Telemetry

| Signal | Name | Attributes |
|---|---|---|
| Histogram | `http.server.request.duration` (s) | `http.request.method`, `http.route`, `http.response.status_code` |
| Counter | `cashight.worker.jobs` | `outcome` = `succeeded` \| `failed` \| `timed_out` |
| Histogram | `cashight.worker.job.duration` (s) | `outcome` |
| Counter | `cashight.aws_invoice_parse_failure` | `error_code` |
| Counter | `cashight.legacy_workspace_fallback`, `cashight.legacy_authz_fallback` | — |
| Span | `<METHOD> <route>`, `worker.job` | same attributes as the matching metric |

`http.route` is the handler name (`dashboard`, `statements`, …), never the URL.
Logs are JSON lines on stdout with `trace_id` and `span_id` when a span is
active. Nothing above carries request bodies, query strings, tokens or
statement content; keep it that way when adding attributes.

## Local use

    pnpm build:servers
    docker build -t cashight-backend:dev .
    docker run --rm -p 8080:8080 \
      -e COGNITO_USER_POOL_ID=<pool id> -e COGNITO_CLIENT_IDS=<client id> \
      cashight-backend:dev
