# Cashight on EKS: observability design (Plan 3)

Status: approved in brainstorming on 2026-10-18. This spec replaces §4.6 of the
[EKS migration design](./2026-10-08-eks-migration-design.md) and the metrics-based
canary analysis in its §4.5.

## 1. Purpose and constraints

**Goal: know when it breaks.** Cashight is a single-user app on one Spot node.
Observability exists to send a Slack message when the app stops working, and to
give enough data to see why. It is not a showcase, and it must cost close to
nothing to run and maintain.

Constraints:

- **Cost.** The platform was cut down to about $96 a month (Plan 2). A
  self-hosted Loki, Tempo, Mimir and Grafana stack would need memory the 4 GiB node
  doesn't have, plus storage and upkeep. Telemetry must add no AWS cost beyond a
  small collector pod.
- **Node capacity.** In-cluster footprint is one collector pod at about 128 MiB.
- **Privacy rules carry over** from the migration design. No PAN, transaction
  description, cardholder name, email or token may appear in a log line, span
  attribute or metric label.
- **Code only.** The cluster isn't created until Plan 4. Plan 3 writes and
  validates everything but applies only the Grafana Cloud side, which is free.

## 2. Decisions

| Topic | Decision |
|---|---|
| Backend | **Grafana Cloud free tier**: 10k metric series, 50 GB logs, 50 GB traces, 14-day retention, $0 |
| Alert delivery | **Slack**, an incoming webhook in the existing workspace |
| Canary gate | **Smoke-test Job.** Argo Rollouts canary steps run Cashight's smoke tests as a Kubernetes Job, and a failing Job aborts the rollout. There is no metrics-based AnalysisTemplate. The Job is built in Plan 4. |
| Collector | One OpenTelemetry Collector **DaemonSet**, from the upstream Helm chart with the contrib image. There is no OpenTelemetry Operator (removed in Plan 2) and no separate gateway. |
| Uptime | **Grafana Synthetic Monitoring** probes `/health` from outside AWS, so it still alerts when the node is gone |
| Config as code | Collector: GitOps in `aws-eks-infra`. Alerts, dashboards and the synthetic check: Terraform in `cashight` (`terraform/grafana/`) |

## 3. Collection

### 3.1 Collector

- **Install.** The upstream `opentelemetry-collector` Helm chart, image
  `otel/opentelemetry-collector-contrib`, `mode: daemonset`, namespace
  `observability`. It is added as an Argo CD add-on under
  `aws-eks-infra/gitops/platform/config/addons`, next to the LB controller and
  KEDA, so it takes effect once `enable_argocd` is on (Plan 4). Chart and image
  versions are pinned.
- **Resources.** Requests 100m CPU and 128Mi memory, limit 256Mi. The
  `memory_limiter` processor is set below the limit, so the collector drops data
  rather than getting OOM-killed.
- **Receivers** (plus the self-monitoring scrape below).
  - `otlp`: HTTP only, on 4318. Apps send traces, metrics and logs here.
  - `filelog`: reads `/var/log/pods/*/*/*.log` through a hostPath mount, so
    stdout from every pod, including add-ons, reaches Loki. The collector's own
    logs are excluded.
  - `kubeletstats`: node and pod CPU, memory and filesystem from the local
    kubelet on 10250.
  - `k8s_cluster`: pod phase, container restarts and deployment replicas. It sits
    behind the `k8s_leader_elector` extension, so only one collector reports it
    once there is more than one node.
- **Processors**, in this order: `memory_limiter`, then `k8sattributes`, then an
  attribute allowlist, then `batch`.
  - `k8sattributes` adds only `k8s.namespace.name`, `k8s.pod.name`,
    `k8s.container.name` and `k8s.node.name`. No labels or annotations, which
    keeps metric series low.
  - The allowlist uses the `attributes` and `transform` processors. It keeps the
    resource attributes `service.*` and `k8s.*`, plus the span and metric
    attributes Cashight emits (see §3.3), and drops everything else.
- **Self-monitoring.** A `prometheus` receiver scrapes the collector's own
  metrics on `localhost:8888` into the metrics pipeline. Alert rule 2 depends on
  `otelcol_process_uptime` arriving this way.
- **Exporter.** `otlphttp` to the stack's OTLP gateway, authenticated by the
  `basicauth` extension (instance ID as user, token as password). One endpoint
  carries all three signals.
- **RBAC.** A ClusterRole with read-only `get/list/watch` on pods, namespaces,
  nodes, replicasets, deployments, statefulsets, daemonsets, jobs and `nodes/stats`,
  plus `coordination.k8s.io` leases in `observability` for leader election.
- **Pod security.** The `observability` namespace is labelled Pod Security
  `privileged`, because `filelog` needs a hostPath mount. Pod log files on the
  node are root-owned `0640`, so the collector runs as UID 0, with all
  capabilities dropped, a read-only root filesystem and read-only hostPath
  mounts. This namespace has **no default-deny**
  NetworkPolicy: its only inbound traffic is OTLP, and it needs egress to the
  internet.

### 3.2 Uptime

Synthetic Monitoring runs an HTTP check against
`https://api.cashight-v2.nghuy.link/health` every 2 minutes from Singapore and
Tokyo. That is about 43k runs a month against the free allowance of 100k. The
check expects HTTP 200 within 5 seconds.

### 3.3 What Cashight already sends (Plan 1)

Plan 1 (`docs/container-runtime.md`, `backend/shared/observability.ts`) already
instruments the backend. Plan 3 changes no application code.

- Metrics: `http.server.request.duration` (attributes `http.request.method`,
  `http.route` (the handler name), `http.response.status_code`),
  `cashight.worker.jobs` (`outcome` = `succeeded|failed|timed_out`),
  `cashight.worker.job.duration`, `cashight.aws_invoice_parse_failure`
  (`error_code`), and the legacy-fallback counters.
- Spans: `<METHOD> <route>` and `worker.job`.
- Resource: `service.name`, `service.namespace=cashight`,
  `service.version=APP_VERSION`.
- Logs: JSON lines on stdout, carrying `trace_id` and `span_id`. These arrive
  through `filelog`, not OTLP, so Loki has one copy.
- Export is off when `OTEL_EXPORTER_OTLP_ENDPOINT` is unset. Plan 4 sets it to
  `http://otel-collector.observability:4318` on every Cashight workload.

Exception: if the local verification run (§6) finds an attribute that breaks the
privacy rules or the series budget, the fix goes in the app as part of Plan 3.

## 4. Secrets and wiring

| Secret or value | Where it lives | Who reads it |
|---|---|---|
| OTLP write token (`metrics:write`, `logs:write`, `traces:write`) | SSM SecureString `/platform/aws-eks-infra/grafana-cloud/otlp-token` | Collector init container |
| OTLP endpoint URL and instance ID (not secret) | SSM String `/platform/aws-eks-infra/grafana-cloud/{otlp-endpoint,instance-id}` | Collector init container. Recorded in the runbook. |
| Grafana service-account token (Terraform provider) and Synthetic Monitoring token | Workstation environment or ignored `terraform.tfvars` only | `terraform/grafana/` |
| Slack webhook URL | SSM SecureString `/cashight/grafana/slack-webhook-url` | `terraform/grafana/` (data source) |

- **Token delivery.** An init container (the AWS CLI image) runs under **EKS Pod
  Identity**. It fetches the three parameters into a memory-backed `emptyDir`.
  The collector config reads them with `${file:/secrets/...}`. No Kubernetes
  Secret is created, and nothing secret is in Git.
- **aws-eks-infra Terraform** (`modules/platform_cluster` and
  `environments/platform`): an IAM role for the collector, trusted by
  `pods.eks.amazonaws.com`, with `ssm:GetParameter` on
  `parameter/platform/aws-eks-infra/grafana-cloud/*` and `kms:Decrypt` through
  the SSM service. Also a Pod Identity association for
  `observability/otel-collector`. The SecureString itself is created by hand
  (runbook), so its value never enters Terraform state.
- **Cashight Terraform.** A new root `terraform/grafana/` with its own state key
  in the existing `cashight-tfstate` bucket. It uses the `grafana/grafana`
  provider and leaves the existing roots untouched.
- **Plan 4 contract.** The `cashight` namespace NetworkPolicies must allow egress
  to namespace `observability` on TCP 4318. Workloads get
  `OTEL_EXPORTER_OTLP_ENDPOINT` as in §3.3.

## 5. Alerts and dashboard

All of this is defined in `terraform/grafana/` as Grafana-managed alert rules,
one folder `Cashight v2`.

### 5.1 Rules

| # | Alert | Condition | Severity, pending period | Covers |
|---|---|---|---|---|
| 1 | API down | The synthetic check fails from both probes for 3 consecutive runs (about 6 min) | critical, 0 | Node gone, Spot interruption, ALB, DNS or certificate broken, pods not serving |
| 2 | Telemetry stopped | No `otelcol_process_uptime` series for 10 min | critical, 0 | Cluster dead or collector broken. Also catches silent failures while the app still answers. |
| 3 | API errors | 5xx share of `http.server.request.duration` count > 5% over 10 min, **and** ≥ 20 requests | warning, 5 min | A failing handler: bad deploy, AWS permission, Gemini outage |
| 4 | Parse jobs failing | `increase(cashight.worker.jobs{outcome!="succeeded"}[15m]) > 0` | warning, 5 min | A statement or invoice failed to parse or timed out |
| 5 | Pod crash-looping | Container restarts ≥ 3 in 15 min, in `cashight`, `observability` or `keda` | warning, 5 min | Bad config, OOM kills (likely on a 4 GiB node), broken image |

Missing data: rule 2 treats no data as firing. Rules 3–5 treat no data as OK,
because no traffic is normal for this app.

Exact PromQL metric names depend on how Grafana Cloud translates OTLP names
(dots to underscores, unit and `_total` suffixes). The plan takes them from the
local verification run (§6), not from guesses.

The parse-failure counter `cashight.aws_invoice_parse_failure` is shown on the
dashboard but not alerted. It is a legacy-path signal, and rule 4 already covers
failed jobs.

### 5.2 Notifications

- One Slack contact point (webhook URL from SSM).
- One notification policy, grouped by `alertname`. Group wait 30 s, group
  interval 5 min, repeat interval 4 h. Resolved notifications on.

### 5.3 Uptime gating

`terraform/grafana/` has a variable `api_live` (default `false`). With it false,
the synthetic check is created **disabled** and rule 1 is paused. Plan 4 flips it
once `api.cashight-v2.nghuy.link` serves. Rule 2 has its own flag,
`collector_live` (default `false`): before the collector exports it would fire
permanently, but the collector runs before the API serves, so tying it to
`api_live` would leave collector outages in that window unalerted. Rules 3–5
stay active: with no data they don't fire.

### 5.4 Dashboard

One dashboard, **"Cashight v2"**, stored as JSON in
`terraform/grafana/dashboards/cashight-v2.json` and provisioned by Terraform.

- Request rate, error rate and p95 latency per `http.route`, one row per API.
- Worker jobs by outcome, job duration p50 and p95, and invoice parse failures by
  `error_code`.
- Node and pod CPU and memory against limits, from `kubeletstats`. This panel
  shows when the 4 GiB node is full.
- Container restarts.
- Logs: Loki, `k8s_namespace_name="cashight"`, with the `trace_id` derived field
  linking to Tempo.

The migration design's other dashboards (cluster health, Argo CD sync) are
dropped. The stack's built-in Kubernetes views cover them if ever needed.

## 6. Testing and verification

| Check | How |
|---|---|
| Collector config | `helm template` with the repo values, then `otelcol-contrib validate` on the rendered config in a container. `kubeconform` through `make yaml-check` in aws-eks-infra. |
| End-to-end pipeline | A local run: one collector container with the same pipeline minus the Kubernetes receivers, and the backend from `pnpm dev:local` with `OTEL_EXPORTER_OTLP_ENDPOINT` pointed at it. Make some requests and run one parse job, then confirm in Grafana that a metric, a trace and a log line arrived and are linked by `trace_id`. Also check that no attribute outside the allowlist arrived. |
| Alert rules | `terraform apply` of `terraform/grafana/` against the free stack. Run each rule's query in Explore against the local-run data. Fire rules 3 and 4 once for real (a failing route, a non-PDF upload) and confirm they resolve. |
| Slack delivery | The contact point's test button, plus the real fire and resolve above |
| aws-eks-infra Terraform | `make terraform-check`. The role and association are applied with the cluster in Plan 4. |
| Cashight | `pnpm test`, `pnpm tsc --noEmit` and `terraform validate` on `terraform/grafana/` stay green |

**Deferred to Plan 4's acceptance list:** Kubernetes receiver data (kubeletstats,
k8s_cluster, pod logs), rule 5 firing for real, `api_live = true` with rule 1 and
the check active, and the egress NetworkPolicy to `observability:4318`.

## 7. Rollout

- The Lambda stack keeps its CloudWatch alarms and logs until migration phase 7.
  Plan 3 doesn't touch them.
- `terraform/grafana/` is applied from the workstation, because the Grafana
  tokens exist only there. No CI job applies it. CI may run `terraform fmt
  -check` and `validate` on it with `-backend=false`.
- **Manual steps**, in a new runbook `docs/observability.md` (about 15 minutes,
  once): create the Grafana Cloud stack in a Singapore-region cluster; create the
  OTLP write token, the Terraform service-account token and the Synthetic
  Monitoring token; create the Slack incoming webhook; write the SSM parameters
  from §4.
- Migration design edits: §4.6 and the analysis-template text in §4.5 point to
  this spec, and open point 2 (notification channel) is closed as Slack.

## 8. Out of scope

- Self-hosted Loki, Tempo, Mimir or Grafana.
- Metrics-based canary analysis.
- Argo CD, Rollouts, KEDA and LB controller metrics scraping.
- Retention beyond the free tier's 14 days.
- Paging or on-call. Slack is the only channel.
- Alerting on the old Lambda stack from Grafana.
