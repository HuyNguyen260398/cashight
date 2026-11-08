# Cashight v2 minimal — design

Date: 2026-11-08 · Branch base: `cashight-v2` · Status: draft, awaiting approval

## 1. Intent

The v2 EKS platform (Plans 4a–4c) works, but it is built as a test-day
environment: 2 × `t4g.large` nodes, managed Argo CD, Argo Rollouts, KEDA,
cert-manager and an OpenTelemetry Collector, all brought up and destroyed in a
day.

**Cashight v2 minimal** is a second variant of that infrastructure, intended to
**stay running all the time** at the **lowest cost at which the app still
works**, using **serverless compute only** (no EC2 nodes to manage).

Decided with the user:

- Compute is **EKS on Fargate**. No node groups, no Auto Mode.
- It is **always-on**, not a test-day environment.
- **Managed Argo CD is removed.** Deploys are pushed from GitHub Actions and
  must still prove that they worked (§6).
- Only add-ons the app cannot run without are kept.
- **The AI summary feature is disabled** in minimal, and everything that exists
  only to support it is removed (§5.4).
- From the cost-cut menu, the user chose:
  1. **Parse workers run as SQS-triggered Lambdas** instead of pods.
  2. **`cashight-api` and `cashight-aws-api` merge into one Deployment.**
  3. **Only app logs go to CloudWatch, kept for 7 days.**

  The user declined replacing the ALB with API Gateway + VPC Link + Cloud Map.
  A Savings Plan was not chosen.

## 2. Goals, non-goals, anti-goals

**Goals**

- The v2 SPA (`cashight-v2.nghuy.link`) and API (`api.cashight-v2.nghuy.link`)
  serve the app continuously: uploads, parsing (TPBank and VIB), dashboard,
  statements and the AWS cost/invoice views. The AI summaries are the only
  exception.
- Steady-state cost of roughly **$165–175/month**, verified against real prices
  (§8).
- A GitHub Actions deploy that waits for rollout health, runs the existing smoke
  suite, and rolls back automatically on failure.
- Every piece is reproducible from Terraform and repo manifests.

**Non-goals**

- Changing v1 in any way. v1 stays untouched (decision of 2026-11-05).
- Changing the existing ephemeral v2 platform (`terraform/platform`,
  `deploy/platform`, `deploy/cashight/overlays/v2`). It stays as it is and can
  still be used for test days.
- Canary releases, GitOps drift correction, in-cluster telemetry pipelines.
- High availability. One replica of each pod is accepted, and a pod restart
  means a short outage.

**Anti-goals** (it fails if any of these happen, even when the app runs)

- Any EC2 instance the project has to manage, including NAT instances such as
  fck-nat.
- The cluster drifting onto **EKS extended support** ($0.60/h instead of
  $0.10/h).
- Deploys that can report success while the API is broken.
- Any PCI or AI-payload convention in `CLAUDE.md` weakened. Removing Gemini
  only removes surface area.

## 3. Constraints

- Region `ap-southeast-1`. Graviton/arm64 image, which Fargate supports.
- EKS Fargate pods must run in **private subnets** and cannot get public IPs.
  Outbound access to ECR, STS, SQS, SSM, CloudWatch Logs, Cognito's public JWKS
  and Cost Explorer / invoice APIs still needs a path out. One NAT gateway is
  cheaper than about 7 interface endpoints (~$45 vs ~$65/month), so **one NAT
  gateway in one AZ** is the choice. S3 and DynamoDB use **free gateway
  endpoints**.
- Fargate does **not** support EKS Pod Identity, DaemonSets or the VPC CNI
  NetworkPolicy agent. Pods use **IRSA**, and the NetworkPolicies are dropped.
- Fargate bills each pod at its requests, rounded up to a Fargate size after
  adding 256 MiB for the kubelet. The minimum is 0.25 vCPU / 0.5 GB.
- The persistent v2 data stores, CloudFront/SPA, certificates and DNS from
  `terraform/v2` are reused as they are (§4.1).
- Terraform state in `cashight-tfstate` (KMS `alias/cashight-tfstate`), applied
  from the workstation, matching the other roots.

## 4. Architecture

```
Browser ── CloudFront (cashight-v2.nghuy.link, terraform/v2, unchanged)
   │
   └── api.cashight-v2.nghuy.link ── ALB (public subnets, ACM cert from terraform/v2)
                                        │  target-type ip
                                        ▼
                        EKS (Fargate only, private subnets, 2 AZs)
                          ├─ cashight-api        ×1  (merged API, all routes)
                          ├─ aws-load-balancer-controller ×1
                          └─ coredns             ×1
                                        │
              private subnets ── NAT gateway (1 AZ) ── internet / AWS APIs
                              └─ S3 + DynamoDB gateway endpoints

uploads bucket ─(existing S3→SQS notification)─► cashight-v2-parse ─► Lambda parser-worker
                                       cashight-v2-invoice-parse ─► Lambda invoice-parser-worker
```

### 4.1 Relationship to the existing v2

- **Reused unchanged** (`terraform/v2`): table `cashight-v2`, the statements,
  uploads and cost-exports buckets, both queues and their DLQs, the S3→SQS
  notification, the ECR repository, the CloudFront SPA, both ACM certificates,
  the `cashight-v2.nghuy.link` DNS record, and the v2 CI role.
- **Minimal and the ephemeral full platform are mutually exclusive.** Both
  point `api.cashight-v2.nghuy.link` at their own ALB and would both consume
  the same queues. `scripts/platform/bring-up.sh` must refuse to run while the
  minimal cluster exists, and the minimal apply must refuse while
  `cashight-v2` (the full cluster) exists. *(Builder's call how: e.g. an
  `aws eks describe-cluster` check.)*
- The minimal cluster is named **`cashight-v2-min`** so the two can never be
  confused.

### 4.2 New Terraform root: `terraform/v2-minimal/`

Persistent lifecycle (always-on), state key `cashight/v2-minimal/terraform.tfstate`.
It reads `terraform/v2` outputs through `terraform_remote_state`, as
`terraform/platform/workloads.tf` already does.

It holds:

- **VPC.** 2 AZs (EKS and the ALB both need two). Public subnets hold the ALB
  and the NAT gateway. Private subnets hold Fargate pods. **One** NAT gateway
  (`single_nat_gateway = true`). S3 and DynamoDB gateway endpoints. No interface
  endpoints.
- **EKS cluster `cashight-v2-min`.**
  - Kubernetes version in **standard support**, with
    `upgrade_policy { support_type = "STANDARD" }` so AWS auto-upgrades instead
    of billing extended support. A Terraform `check` or test asserts this.
  - Control-plane logging **off**. Secrets envelope encryption uses the
    AWS-owned default, so the customer KMS key from the full platform is not
    created.
  - Public API endpoint (see §6.2 for CIDRs) plus private endpoint.
  - Authentication by **access entries** only: the workstation admin, and the v2
    CI role scoped to the `cashight` namespace (§6).
  - Add-ons: **CoreDNS** configured for Fargate (`computeType: Fargate`,
    `replicaCount: 1`). vpc-cni and kube-proxy are installed only if EKS
    requires them for Fargate networking; they schedule no pods on Fargate
    anyway. No Pod Identity agent.
  - **IRSA OIDC provider.**
- **Fargate profiles:** `kube-system` (CoreDNS, Load Balancer Controller) and
  `cashight`. Both use private subnets only.
- **Fargate logging:** the `aws-observability` namespace and its
  `aws-logging` ConfigMap (Fluent Bit built into Fargate) ship container stdout
  to the log group `/cashight/v2-min/app`, **7-day retention**. The pod
  execution role gets the CloudWatch Logs permissions it needs.
- **AWS Load Balancer Controller**, installed by Terraform's Helm provider (no
  Argo CD to install it), 1 replica, IRSA role, `vpcId` and `region` set
  explicitly (no IMDS on Fargate), WAF/Shield integrations off.
- **IRSA role for `cashight-api`.** This is the union of today's `api` and
  `aws-api` grants in `terraform/platform/workloads.tf`, **minus
  `GetGeminiKey`**.
- **Lambda workers** (§4.4).
- **`api.cashight-v2.nghuy.link` A/AAAA alias** to the ALB. The ALB is found by
  its Ingress group tag, as `terraform/platform` does it today. The two-phase
  `api_alb_ready` flag pattern from the full platform can be reused.
- Tags: `Environment = v2-minimal`, `Project = cashight`, `ManagedBy = Terraform`.
  The tag is registered as a cost allocation tag so §8 can be checked from
  billing.

The full platform's `platform_cluster` module is built around node groups,
Argo CD and Pod Identity. **Builder's call:** write a separate module
(`terraform/modules/platform_cluster_fargate`) or parameterise the existing one.
The existing one must not change its behaviour for `terraform/platform`.

### 4.3 Kubernetes manifests: `deploy/cashight/overlays/v2-minimal/`

Plain Kustomize, applied by CI (§6). It does **not** reuse `deploy/cashight/base`
as is, because that base contains Rollouts, two APIs, KEDA-scaled workers,
NetworkPolicies and PDBs. Builder's call: a new slim base, or an overlay that
deletes those with patches. Whichever is clearer.

Contents:

- The `cashight` Namespace and a small `LimitRange` (so a pod without requests
  cannot land on a large Fargate size by accident) are **owned by Terraform**
  in `terraform/v2-minimal`, not by the overlay. The CI role's
  namespace-scoped `edit` access cannot create cluster-scoped Namespaces or
  LimitRanges. *(My call.)*
- `ServiceAccount cashight-api`, annotated with the IRSA role ARN.
- **`Deployment cashight-api`** (not a Rollout), 1 replica, rolling update
  `maxSurge: 1, maxUnavailable: 0`, `revisionHistoryLimit: 3`. It runs the
  merged entrypoint (§5.1).
  - Requests: **0.25 vCPU / 768 MiB**, memory limit 768 MiB. With Fargate's
    256 MiB, that is 1 GB, which fits the larger of the two current APIs
    (`aws-api` requests 512 MiB). The builder should check real memory use on
    the first deploy and may lower it to fit 0.5 GB.
  - Probes `/healthz` (liveness) and `/readyz` (readiness), the existing
    security context, and a read-only root filesystem with a `/tmp` emptyDir.
- `Service cashight-api`, and an `Ingress` for the existing ALB settings
  (internet-facing, `target-type: ip`, HTTPS with the ACM cert from
  `terraform/v2`, health check `/readyz`) with a **single** `/` path to
  `cashight-api`.
- `ConfigMap cashight-env`: the same keys as `overlays/v2/env.yaml`, **minus**
  `GEMINI_PARAM`, `OTEL_EXPORTER_OTLP_ENDPOINT` and `PARSE_QUEUE_URL` /
  `INVOICE_PARSE_QUEUE_URL` (unless the API itself needs them, in which case
  keep them).
- No NetworkPolicies, PDBs, Rollouts, AnalysisTemplates or KEDA objects.

### 4.4 Workers as Lambdas

`parser-worker` and `invoice-parser-worker` already exist as Lambda handlers
(`backend/functions/`, packaged for v1 by `scripts/build-lambdas.mjs`).
Minimal runs them as Lambdas again, pointed at the **v2** stores:

- arm64, the same memory and timeout as v1's functions, and **reserved
  concurrency 2 and 1**, which match the old KEDA maximums.
- SQS event source mappings on `cashight-v2-parse` and
  `cashight-v2-invoice-parse` (batch size 1, partial batch failures if v1
  uses them). The DLQs stay as `terraform/v2` defines them.
- The environment equals the worker pods' (table, buckets, `PDF_PASSWORD_PARAM`
  `/cashight/prod/pdf-password`, etc.). IAM equals the worker pods' grants in
  `terraform/platform/workloads.tf`.
- CloudWatch log groups with 7-day retention.
- The `dist/lambdas/parser-worker/pdf.worker.mjs` copy step and the DOM
  polyfill ordering rule in `CLAUDE.md` apply.
- Lambda requires the queue visibility timeout to be ≥ the function timeout.
  The v2 queues use 360 s, and v1's timeouts are 120 s (parser) and 300 s
  (invoice parser), so **no queue change is needed**. AWS *recommends* 6×,
  but meeting that would mean editing existing `terraform/v2` attributes and
  changing the full platform's retry behaviour, so we don't. *(My call.)*
- v1's Lambdas set `ENABLE_LEGACY_WORKSPACE_FALLBACK`. The v2 worker pods
  don't, so the minimal Lambdas leave it unset.
- Artifacts: built in CI and deployed by the minimal release workflow (§6).
  Builder's call between zip upload to S3 and `aws lambda update-function-code`.
  Terraform must not fight CI over the code version (`ignore_changes` on
  code fields, or the equivalent).

## 5. Application changes

All of these are **additive or flag-gated**. v1 and the full v2 overlay must
behave exactly as they do today.

### 5.1 Merged API entrypoint

A new container entrypoint (e.g. `dist/servers/api-all/index.js`, built by
`pnpm build:servers` into the same image) serves **both** route sets: today's
`api` routes and the `/aws/*` routes. The existing `api` and `aws-api`
entrypoints stay for the full v2 overlay. `docs/container-runtime.md` gets a row
for it. The required-config check at startup is the union of both APIs'
requirements, minus `GEMINI_PARAM` (§5.4).

### 5.2 `/health` revision

Without Rollouts there is no `rollouts-pod-template-hash`. The minimal
Deployment sets `POD_TEMPLATE_HASH` from the `pod-template-hash` label via the
Downward API. The smoke step (§6) then checks that `/health` reports the new
ReplicaSet's hash, which proves traffic reaches the new pod. The code already
accepts any short lowercase hash. Only the comments in `start-api.ts` /
`http-server.ts` that name the Rollouts label need updating.

### 5.3 Telemetry

`OTEL_EXPORTER_OTLP_ENDPOINT` is unset, so export is off (already supported).
Logs go to stdout and then to CloudWatch through Fargate logging.
`terraform/grafana` keeps the **uptime check** on `api.cashight-v2…/health`.
The collector-based alerts stay off (`collector_live = false`).

### 5.4 Disabling the AI summaries

The feature is disabled **in minimal only**:

- **API:** a config switch (e.g. `AI_SUMMARY_ENABLED=false`, default `true` so
  v1/full v2 are unchanged) makes the merged API **not register** the summary
  routes (`/summaries` and the AWS-invoice summary route), and makes
  `GEMINI_PARAM` not required. Those routes answer 404.
- **SPA:** a build-time flag hides `AiSummaryCard` (`app/components/ai-summary-card.tsx`)
  and the AWS-invoice AI summary (`app/components/aws-invoices/aws-invoice-ai-summary.tsx`).
  The v2-minimal SPA build sets the flag. Builder's call whether the flag is
  also read from `/session/capabilities` instead of build time.
- **Infra removed for minimal:** the `GetGeminiKey` IAM grants, the
  `GEMINI_PARAM` config key, and Gemini in egress rules (the NetworkPolicies
  are gone anyway). The SSM parameter `/cashight/prod/gemini-api-key` belongs
  to v1 and **stays**.
- The existing "AI gets aggregates only" convention and its tests stay in the
  codebase unchanged.

## 6. Deploying without Argo CD

### 6.1 Workflow `v2-minimal-release.yaml`

Trigger: push to `cashight-v2` touching backend, frontend, the minimal overlay,
or the workflow itself, plus `workflow_dispatch`. Jobs **must not** set
`environment:` (the v2 CI role trusts only `ref:refs/heads/cashight-v2`). Steps:

1. Build and push the arm64 image (reuse the v2 Release build). Deploy **by
   digest**.
2. Build the Lambda artifacts and update both worker functions, publishing a
   version so a rollback can point at the previous one.
3. `aws eks update-kubeconfig --name cashight-v2-min`, then render the overlay
   with the digest (`kustomize edit set image` in the runner, so no bot commit
   is needed; builder's call to keep a pin commit if it helps traceability), and
   `kubectl apply -k`.
4. `kubectl rollout status deployment/cashight-api --timeout=5m`.
5. Smoke check: `/health` returns the new `pod-template-hash` (§5.2), then
   `scripts/smoke-serverless.mjs` against both v2 hostnames (it has no summary
   checks today). A new minimal-only check asserts that the summary routes
   answer 404.
6. **On failure of 4 or 5:** `kubectl rollout undo deployment/cashight-api`,
   wait for rollout status, point the worker Lambda aliases back to the
   previous version, and **fail the job**.
7. Build the SPA with the summary flag off, sync it to the v2 frontend bucket,
   and invalidate CloudFront. This happens only after the API checks pass.

`APP_VERSION` is set to the commit SHA as today. The deployed digest appears in
the job summary.

### 6.2 Cluster access for CI

GitHub-hosted runners have no fixed IP, and the EKS public endpoint allows at
most 40 CIDRs. **My call:** the public endpoint is **open (`0.0.0.0/0`)** and
access relies on **IAM authentication plus access entries**. The CI role gets
only `AmazonEKSEditPolicy` **scoped to the `cashight` namespace**. The
`public_access_cidrs != 0.0.0.0/0` check from the full platform therefore does
**not** apply to minimal, and the doc must say so explicitly. Alternatives if
this is rejected: CodeBuild inside the VPC as the deploy runner, or a
self-hosted runner. Both cost more or add moving parts.

The v2 CI role also needs `eks:DescribeCluster` on `cashight-v2-min` and the
Lambda update permissions for the two worker functions. These are additive
changes to `terraform/v2/ci.tf`.

## 7. Removed compared with the full v2 platform

| Removed | Why it is safe |
|---|---|
| EC2 node group (2 × `t4g.large`) | Fargate |
| Managed Argo CD + CodeConnections use + bootstrap | CI push deploy with health/smoke/rollback gate |
| Argo Rollouts, canary services, AnalysisTemplate | Rolling update + smoke gate |
| KEDA (operator, metrics server, webhooks) | Workers are Lambdas |
| cert-manager | Was needed only by in-cluster webhooks; ALB uses ACM |
| OpenTelemetry Collector | Fargate logging to CloudWatch; uptime check stays |
| Pod Identity agent and associations | IRSA (Fargate requirement) |
| NetworkPolicies | Fargate does not enforce them |
| PDBs | Single replica |
| Control-plane audit/authenticator logs and their KMS key | Cost; not needed for a single-user app |
| `cashight-aws-api` as a separate Deployment | Merged API |
| AI summary routes and Gemini access | Feature disabled |

`terraform/platform-base` (budget, CodeConnections, Identity Center group)
stays. Minimal does not use the connection, but the full platform still does.

## 8. Cost target and verification

Estimate, in USD/month, at Singapore list prices. **To be verified**:

| Item | ≈ $/mo |
|---|---|
| EKS control plane (standard support) | 73 |
| NAT gateway, 1 AZ, plus its public IPv4 and low data | 47 |
| ALB, 2 public IPv4, low LCU | 27 |
| Fargate: `cashight-api` (0.25 vCPU / 1 GB), LBC and CoreDNS (0.25 / 0.5 each) | 25–30 |
| Lambda workers, SQS, DynamoDB, S3, CloudFront, ECR, CloudWatch Logs | 2–5 |
| **Total** | **≈ 165–175** |

Verification, part of the acceptance criteria:

- Before apply: recompute the table from the AWS Price List API for
  `ap-southeast-1` (EKS, Fargate arm64, NAT, ALB, public IPv4) and record it in
  `docs/v2-minimal.md`.
- About 7 days after go-live: Cost Explorer grouped by the `Environment`
  tag (and by service for untagged items such as public IPv4). Record the
  actual run rate next to the estimate.
- An AWS Budget for the `v2-minimal` tag at $200/month with an 80 % and 100 %
  email alert. It lives in `terraform/platform-base` beside the account budget,
  as an additive change.

## 9. Acceptance criteria

1. `terraform/v2-minimal` applies cleanly from an empty state. Its plan contains
   no `aws_eks_node_group`, no `aws_instance`, no `aws_eks_capability` and no
   interface VPC endpoints, and has exactly one `aws_nat_gateway`.
2. `kubectl get pods -A -o wide` shows only Fargate nodes, and the only pods
   are `cashight-api` ×1, `aws-load-balancer-controller` ×1 and `coredns` ×1.
3. The release workflow deploys a new digest end to end. A deliberately broken
   build (e.g. failing `/readyz`) is rolled back automatically and the job
   fails.
4. The smoke suite passes against `cashight-v2.nghuy.link` and
   `api.cashight-v2.nghuy.link`. Uploading the TPBank and VIB sample PDFs
   produces statements matching the expected values in `CLAUDE.md`, parsed by
   the Lambda workers.
5. The summary routes return 404 in minimal, and the SPA shows no AI summary UI.
   v1 and the full v2 overlay still serve summaries (unit tests cover the
   default flag value).
6. The cluster reports standard support, and a test fails if the configured
   version or upgrade policy would allow extended support.
7. `docs/v2-minimal.md` covers apply, deploy, rollback, the mutual exclusion
   with the full platform, teardown, and the cost table with verified prices.
   `docs/platform.md`, `docs/v2-resources.md` and `CLAUDE.md`'s command table
   link to it.
8. `pnpm test`, `pnpm tsc --noEmit`, `pnpm lint`, `terraform fmt/validate/test`
   and the existing platform checks pass. New checks are added for the
   minimal overlay (kubeconform) and root (`terraform test`).
9. No changes to v1 resources, and none to `terraform/platform`'s planned
   behaviour.

## 10. Left to the builder

- New Fargate cluster module vs parameterising `platform_cluster`.
- A new slim manifest base vs patching `deploy/cashight/base`.
- How the mutual-exclusion guard is implemented.
- Lambda artifact delivery mechanics, and whether to keep a pin commit.
- Whether the SPA summary flag is build-time or served by `/session/capabilities`.
- Final pod memory sizes after measuring real use.
