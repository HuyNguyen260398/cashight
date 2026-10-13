# Cashight on EKS — migration design

**Date:** 2026-10-08 · **Status:** proposal, awaiting review
**Scope:** move Cashight's API and worker compute from Lambda + API Gateway to Amazon EKS, with Terraform provisioning, Argo CD GitOps, and a self-hosted Grafana stack fed by OpenTelemetry.

## 1. Decisions already taken

| Decision | Choice |
|---|---|
| Target service | Amazon **EKS** (the request said "AKS", which is Azure's service) |
| Goal | Full production cutover; the serverless compute is decommissioned afterwards |
| Platform ownership | The cluster and platform add-ons live in the existing `aws-eks-infra` repo; Cashight is a workload on it |
| Observability hosting | Self-hosted Grafana stack (Loki, Tempo, Mimir, Grafana) in the cluster |
| Rollout (decided 2026-10-13) | **Parallel stack on a second hostname, not a weighted DNS shift.** The current architecture keeps `cashight.nghuy.link` untouched. The new one comes up at `cashsightv2.nghuy.link` (API at `api.cashsightv2.nghuy.link`). Once it has run smoothly, the old architecture is retired and the new stack is renamed to `cashight.nghuy.link` |
| Branching (decided 2026-10-13) | New-architecture work lives on the long-lived branch `cashight-v2`, cut from `main`. Every feature branch for it is created from `cashight-v2` and merges back into it. `main` keeps deploying the current architecture; `cashight-v2` merges into `main` once, at the retire-and-rename step (phase 7) |

Consequences of the branching decision for later plans: the Argo CD `Application` tracks `cashight-v2` until the rename, so the image-digest commits of §4.5 land on a branch the `main` ruleset does not protect; `ci.yaml` and `tf-ci.yaml` must list `cashight-v2` as a pull-request target; and fixes made on `main` are merged forward into `cashight-v2`, never the reverse.

On the "Grafana stack using OpenTelemetry" requirement: OpenTelemetry is the instrumentation and collection layer (SDK in the app, Collectors in the cluster). The Grafana stack is where the data is stored and viewed. Kubernetes component metrics are still published in Prometheus format, so the Collector scrapes them and forwards everything as OTLP.

## 2. Current architecture

`CLAUDE.md` still describes the Amplify SSR app. That runtime was decommissioned on 2026-07-03. What runs today:

| Layer | Deployed today | Terraform |
|---|---|---|
| Edge | Next.js static export in S3 behind CloudFront, `cashight.nghuy.link` | `edge.tf`, `acm.tf` |
| API | Regional API Gateway REST API from an OpenAPI template: Cognito authorizer, request validators, CORS, stage throttle (100 rps, burst 50), 29 s integration cap, `api.cashight.nghuy.link` | `api.tf`, `api-openapi.yaml.tftpl` |
| Compute | 12 Node 22 Lambdas: 9 HTTP APIs, 2 SQS workers, 1 Cognito trigger. Each has its own IAM role, log group, `live` alias and CodeDeploy canary | `compute.tf` |
| Data | DynamoDB single table (on-demand), S3 buckets (statements, uploads, cost exports), 2 SQS queues with DLQs fed by S3 notifications, 2 SSM SecureString parameters | `data.tf`, `s3.tf` |
| Auth | Cognito user pool with Google federation, PKCE SPA client, smoke-test client | `cognito.tf` |
| Delivery | GitHub Actions with OIDC; Lambda zips via CodeDeploy; frontend via S3 sync and invalidation | `application-deploy.yaml` |
| Observability | Lambda Powertools (logger, metrics, tracer), X-Ray, CloudWatch logs with 30-day retention | `backend/shared/observability.ts` |

Properties that make the migration tractable:

- Handlers are thin. Logic lives in `packages/domain` and `backend/shared`.
- `scripts/dev-server.ts` already runs the production handlers behind a plain Node HTTP server with the same route table as the OpenAPI template. The container entrypoint can reuse that routing.
- Responses are buffered, not streamed (API Gateway REST has no streaming path), so no streaming ingress is needed.
- Secrets are read from SSM by the AWS SDK at runtime, so no Kubernetes Secret objects are needed for the app.
- Worker handlers are idempotent (conditional DynamoDB writes), so Lambda and Kubernetes consumers can share a queue during cutover.

Run cost today is about $1.36/month.

## 3. What moves and what stays

| Component | Outcome | Reason |
|---|---|---|
| 9 API Lambdas | Move to EKS as 2 Deployments | See §4.2 |
| 2 SQS worker Lambdas | Move to EKS as 2 KEDA-scaled Deployments | |
| API Gateway, CodeDeploy, per-Lambda roles and log groups, X-Ray | Removed after cutover | Replaced by ALB Ingress, Argo Rollouts, Pod Identity, the Grafana stack |
| `auth-guard` Lambda | **Stays a Lambda** | Cognito triggers can only invoke Lambda |
| S3, DynamoDB, SQS, SSM, Cognito, Route 53, ACM | Stay, unchanged, in `cashight/terraform` | Not Kubernetes workloads; no data migration is needed |
| SPA on CloudFront + S3 | Stays | A static export gains nothing from a container; it keeps its current GitHub Actions deploy |

## 4. Target architecture

Hostnames below are the ones used during the parallel run. After the rename (phase 7) they become `cashight.nghuy.link` and `api.cashight.nghuy.link`. Until then the existing stack keeps serving those names exactly as described in §2.

```text
Browser ──► cashsightv2.nghuy.link ─► CloudFront + S3 (v2 build of the SPA)
   │
   └─► api.cashsightv2.nghuy.link ─► shared ALB (platform-public, ACM TLS)
                                      │  Ingress
              ┌───────────────────────┴───────────────────────┐
              ▼                                               ▼
     cashight-api (Rollout)                        cashight-aws-api (Rollout)
     uploads, upload-status, statements,           cost-explorer, aws-invoices,
     dashboard, summary, session                   aws-invoice-summary
              │                                               │
              └────────── Pod Identity (one IAM role per workload) ──────────┐
                                                                             ▼
   S3 uploads ─► SQS parse ─────────► parser-worker (KEDA 0–2)        DynamoDB, S3,
   S3 uploads ─► SQS invoice-parse ─► invoice-parser-worker (KEDA 0–1)  SSM, Cost Explorer

   All pods ── OTLP ──► OTel Collector gateway ──► Mimir / Loki / Tempo (S3) ──► Grafana
   Nodes ── OTel Collector DaemonSet (logs, kubelet and host metrics) ──┘

   Cognito ─► auth-guard Lambda (unchanged)
   Git ─► Argo CD (EKS managed capability) ─► cluster
```

### 4.1 Platform changes (`aws-eks-infra`)

The platform is Fargate-only today. Self-hosted Loki, Tempo and Mimir need EBS volumes, and node-level log and metric collection needs DaemonSets; Fargate supports neither. So the platform gains EC2 capacity:

- One EKS managed node group: Graviton (`t4g.large`), on-demand, 3 nodes across 3 AZs, private subnets. Fargate stays for the existing system and add-on namespaces.
- EBS CSI driver and EKS Pod Identity Agent add-ons.
- KEDA as a new Argo CD-managed add-on, alongside the existing cert-manager, AWS Load Balancer Controller, Argo Rollouts and OpenTelemetry Operator.
- A `cashight` namespace created with the existing `namespace-config` chart (quota, limits, RBAC, default-deny NetworkPolicy). The name deliberately avoids the `apps-*` pattern so pods land on EC2 nodes rather than the Fargate profile, which lets the DaemonSet collector see their logs.
- The CodeConnections connection extended so managed Argo CD can read the `cashight` repo.
- The cluster identifiers Cashight needs (cluster name, ALB group name) published as Terraform outputs / SSM parameters.

### 4.2 Workloads

Four workloads, grouped by IAM privilege boundary rather than one per former Lambda. Eleven separate Deployments would be heavy for a single-user app, while one combined API would merge bank data access with AWS billing access.

| Workload | Former Lambdas | IAM scope | Scaling |
|---|---|---|---|
| `cashight-api` | uploads, upload-status, statements, dashboard, summary, session-capabilities | statements and uploads buckets, DynamoDB table, Gemini SSM parameter | 2 replicas, PDB |
| `cashight-aws-api` | cost-explorer, aws-invoices, aws-invoice-summary | Cost Explorer and Billing read, cost-exports bucket, DynamoDB table, Gemini SSM parameter | 2 replicas, PDB |
| `parser-worker` | parser-worker | uploads and statements buckets, DynamoDB, PDF password SSM parameter, parse queue | KEDA on queue depth, 0–2 |
| `invoice-parser-worker` | invoice-parser-worker | uploads and cost-exports buckets, DynamoDB, invoice-parse queue | KEDA on queue depth, 0–1 |

The KEDA maximums match today's reserved concurrency. Memory requests follow the current Lambda sizes (1.5 GiB and 2 GiB for the workers).

### 4.3 Application changes (`cashight`)

- **HTTP entrypoint.** A small Node server per API workload that maps routes to the existing handlers, sharing the route table with `scripts/dev-server.ts`. Handlers keep their `(event) → ApiResponse` signature.
- **JWT verification.** API Gateway's Cognito authorizer is replaced by middleware using `aws-jwt-verify` against the user pool. It produces the same claims object that `extractAccessClaims` reads, so authorization code is untouched.
- **What API Gateway did implicitly.** CORS, request size limits and rate limiting move into the server. The allowed CORS origin is per-deployment configuration (`ALLOWED_ORIGIN`, default `https://cashight.nghuy.link`), still exactly one origin per deployment (SEC-006), so the v2 stack can answer for `https://cashsightv2.nghuy.link` and be renamed without a new image. Request validation is already covered by Zod at each handler boundary; the implementation plan must diff the OpenAPI validators against the Zod schemas to confirm parity.
- **Worker entrypoint.** An SQS long-polling loop that calls the existing worker handlers one message at a time, extends visibility while working, deletes on success, and leaves failures to the existing redrive policy (3 receives, then DLQ). It handles SIGTERM by finishing the in-flight message.
- **Observability adapter.** `backend/shared/observability.ts` swaps Powertools for the OpenTelemetry SDK behind the same `logger`, `metrics` and `tracer` exports. `sanitizeForLog` stays in the path unchanged.
- **Images.** One multi-stage arm64 Dockerfile producing the four entrypoints. The parser image must include `pdf.worker.mjs`, and the DOM polyfill import order rule still applies.
- **Health.** `/healthz` and `/readyz` endpoints, plus graceful shutdown.

### 4.4 Cashight Terraform changes

- ECR repositories with scan-on-push and lifecycle rules.
- Four IAM roles with EKS Pod Identity associations, each carrying the union of its former Lambda policies and nothing more.
- A GitHub OIDC permission to push images, replacing the Lambda deploy permissions.
- New Route 53 records and ACM certificates for the v2 names: `api.cashsightv2.nghuy.link` (regional, on the ALB) and `cashsightv2.nghuy.link` (us-east-1, on CloudFront). The existing records and certificates for `cashight.nghuy.link` and `api.cashight.nghuy.link` are not modified.
- A second SPA origin for `cashsightv2.nghuy.link`: the same static export built with `NEXT_PUBLIC_API_BASE_URL` and `NEXT_PUBLIC_APP_ORIGIN` set to the v2 names, in its own S3 prefix or bucket behind CloudFront.
- The v2 origin added wherever the production origin is allowlisted today: Cognito callback and sign-out URLs (`cognito.tf`) and the CORS rules on the statements and uploads buckets (`data.tf`), which presigned uploads depend on. These are additions; the production entries stay.
- After the soak: removal of `api.tf`, the 11 migrated Lambdas, their roles, log groups, CodeDeploy apps and API Gateway permissions. Then the rename: the `cashight.nghuy.link` and `api.cashight.nghuy.link` records are pointed at the new stack (the existing regional certificate for `api.cashight.nghuy.link` is attached to the ALB), `ALLOWED_ORIGIN` and the SPA build switch back to the production names, and the v2 records, certificates and allowlist entries are removed.

Terraform owns AWS resources; Argo CD owns everything inside the cluster. Nothing is managed by both.

### 4.5 GitOps

- Manifests live in the `cashight` repo under `deploy/` as Kustomize `base/` and `overlays/prod/`: Rollouts, Services, Ingress (joining the shared ALB group), ScaledObjects, ServiceAccounts, PodDisruptionBudgets, NetworkPolicies.
- An Argo CD `Application` for Cashight is registered in `aws-eks-infra/gitops/workloads/config/`, following the existing Jenkins pattern. Automated sync with prune and self-heal.
- **Release flow.** CI builds and pushes an image tagged by commit SHA, then commits the image digest into `deploy/overlays/prod`. Argo CD detects the change and syncs. CI never holds cluster credentials and never runs `kubectl`.
- **Progressive delivery.** Argo Rollouts canaries replace CodeDeploy: 10% → 50% → 100%, with an AnalysisTemplate querying Mimir for error rate and latency, and automatic abort.
- **Rollback** is `git revert` of the digest commit.
- Images are pinned by digest, never by mutable tag.

Open point for the plan: `main` is protected by a ruleset, so the digest commit needs either a bot identity with bypass or an auto-merged PR.

### 4.6 Observability

| Signal | Collection | Backend |
|---|---|---|
| App traces | OTel SDK → OTLP → Collector gateway | Tempo |
| App metrics | OTel SDK → OTLP → Collector gateway | Mimir |
| App and pod logs | Collector DaemonSet (`filelog`) | Loki |
| Node and kubelet metrics | Collector DaemonSet (`hostmetrics`, `kubeletstats`) | Mimir |
| Cluster state | kube-state-metrics scraped by the Collector's Prometheus receiver | Mimir |
| Argo CD, Rollouts, KEDA, ALB controller metrics | Prometheus receiver | Mimir |

- Collectors are deployed as `OpenTelemetryCollector` resources through the OpenTelemetry Operator already on the platform.
- Loki, Tempo and Mimir run in single-binary / monolithic mode with S3 object storage and small gp3 volumes. Buckets and Pod Identity roles are Terraform-managed in `aws-eks-infra`. Telemetry survives a cluster rebuild because it lives in S3.
- Grafana is exposed on the shared ALB behind Cognito sign-in. Data sources, dashboards and alert rules are provisioned as code through Argo CD.
- Starting dashboards: cluster and node health, workload RED metrics per API, queue depth and worker duration, parse success and failure counts, Argo CD sync status.
- Grafana Alerting replaces the existing CloudWatch alarms. The notification channel is an open point.
- **Privacy rules carry over.** No PAN, transaction description, cardholder name, email or token may appear in a log line, span attribute or metric label. Span attributes are allowlisted; HTTP body capture stays off.

## 5. Migration phases

Each phase leaves production working and is independently reversible until phase 7.

| # | Phase | Repo | Exit criterion |
|---|---|---|---|
| 0 | Prerequisites: fix the Terraform CI role (#113), set an AWS budget alarm, confirm IAM Identity Center | both | Infra workflow can plan |
| 1 | Platform: node group, add-ons, KEDA, `cashight` namespace, repo access | `aws-eks-infra` | `verify-platform.sh` passes with EC2 nodes |
| 2 | Observability stack and collectors, dashboards, alerts | `aws-eks-infra` | Cluster metrics, logs and traces visible in Grafana |
| 3 | Containerise: HTTP and worker entrypoints, JWT middleware, OTel adapter, Dockerfile | `cashight` | Unit tests pass; images run locally against the local stack |
| 4 | Cashight AWS resources: ECR, Pod Identity roles, v2 DNS records and certificates, v2 origin in the Cognito and S3 CORS allowlists | `cashight` | `terraform plan` shows only additions; nothing serving `cashight.nghuy.link` changes |
| 5 | GitOps manifests, Argo CD Application, CI image pipeline, v2 SPA build | both | Workloads healthy; smoke tests pass against `cashsightv2.nghuy.link` and `api.cashsightv2.nghuy.link` |
| 6 | Parallel run: use the app on `cashsightv2.nghuy.link` while `cashight.nghuy.link` stays on the old stack. Within the soak, disable the Lambda SQS event source mappings and enable the KEDA workers, so the workers are proven too | `cashight` | Smoke and e2e tests green on the v2 hostname; two-week soak with no fallback to the old stack |
| 7 | Retire the old architecture (API Gateway, migrated Lambdas, CodeDeploy), then rename: point `cashight.nghuy.link` and `api.cashight.nghuy.link` at the new stack and remove the v2 names; update docs and `CLAUDE.md` | `cashight` | `terraform plan` clean; the app works on `cashight.nghuy.link`; cost report shows serverless compute at zero |

**Fallback during phases 4–6:** keep using `cashight.nghuy.link`. The old stack is never modified, so there is nothing to roll back for the API. If the queue consumers have been switched, re-enable the event source mappings. Data stores are shared and untouched, so no data rollback exists.

**The queues are the one thing the two stacks cannot run in parallel.** An upload from either hostname lands in the same bucket and the same queue, so whichever consumer is attached parses it. Switching the consumers in phase 6 therefore means uploads made on the old hostname are parsed by the EKS workers. That is safe (the handlers are idempotent and write to the same table) and reversible, but it is the point where the old hostname starts depending on the new stack.

**Phase 7 is the point of no return**, and its two halves have an order: retire first, rename second, as decided. Between them `cashight.nghuy.link` still serves the old SPA, whose API is gone, so the app is only usable on the v2 hostname until the rename lands. Do both in one session.

## 6. Cost

Estimates from list prices recalled for `ap-southeast-1`, not quotes. Verify with the AWS calculator before committing.

| Item | Approx. $/month |
|---|---:|
| EKS control plane | 73 |
| 3 × `t4g.large` on-demand nodes | 185 |
| NAT gateway (single) | 45 |
| Shared ALB | 22 |
| EBS, S3 telemetry storage, Fargate system pods, CloudWatch control-plane logs | 15–25 |
| EKS managed capability fees (Argo CD, ACK, kro) | not estimated |
| **Total** | **≈ 340–350 plus capability fees** |

That compares with about $1.36/month today. Two nodes instead of three would save about $60 at the cost of AZ spread and headroom.

## 7. Risks

| Risk | Mitigation |
|---|---|
| Cost rises by roughly 250× for a single-user app | Budget alarm in phase 0; explicit go/no-go after phase 2, when the platform bill is real but production is untouched |
| Ongoing operations: EKS version upgrades, add-on upgrades, node patching, stack upgrades | Managed node group and managed Argo CD reduce it; document an upgrade runbook |
| A regression in authorization when replacing the API Gateway authorizer | Middleware unit tests with real token shapes; smoke tests for 401 and 403 paths before any traffic shift |
| Loss of API Gateway throttling and validation | In-server rate limit; validator-versus-Zod parity check |
| PII reaching Loki or Tempo | Existing `sanitizeForLog`, span attribute allowlist, and `scripts/security-scan-logs.ts` extended to query Loki |
| Monitoring stack shares fate with the cluster it monitors | Telemetry in S3; one external uptime check on `/healthz` |
| Duplicate processing while both consumers are attached to a queue | Handlers are already idempotent; keep the overlap window short |
| EKS API allowlisted to a single `/32` | Argo CD is in-cluster and CI needs no cluster access, so only operators are affected |

## 8. Out of scope

- Containerising the SPA or moving it off CloudFront.
- Replacing Cognito, DynamoDB, S3 or SQS.
- Multi-environment (staging) clusters.
- Service mesh, multi-region, or multi-cluster.

## 9. Open points for the implementation plan

1. Bot commit with ruleset bypass, or auto-merged PR, for image digest updates.
2. Grafana Alerting notification channel.
3. Two or three nodes.
4. Whether `auth-guard` keeps its CodeDeploy canary or becomes a plain Terraform-deployed zip.
5. Whether the v2 frontend reuses the existing Cognito SPA app client (add the v2 callback URLs to it) or gets its own client. Reuse is simpler and is what the rename wants; a separate client isolates the v2 sign-in config.
6. Whether the v2 SPA gets its own CloudFront distribution or is added to the existing one as a second origin and alias. A separate distribution keeps the current edge untouched until the rename.
