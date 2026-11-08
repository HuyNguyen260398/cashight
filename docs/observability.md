# Observability (Cashight v2 on EKS)

Runbook for the telemetry described in
[the observability design](superpowers/specs/2026-10-18-eks-observability-design.md).
The goal is narrow: **a Slack message when Cashight v2 stops working, and enough
data to see why.** The Lambda stack keeps its CloudWatch alarms and logs until
migration phase 7; nothing here touches them.

## 1. What runs where

One OpenTelemetry Collector DaemonSet (`observability/otel-collector-agent`,
Service `otel-collector.observability:4318`) collects OTLP from Cashight's
workloads, pod logs from the node, and kubelet and cluster metrics, and sends all
of it to the **Grafana Cloud free tier**. Alerts, the dashboard and the uptime
check are Grafana-side, defined in `terraform/grafana/`.

| Secret or value | Where it lives | Who reads it |
|---|---|---|
| OTLP write token (`metrics:write`, `logs:write`, `traces:write`) | SSM SecureString `/cashight/grafana-cloud/otlp-token` | Collector init container (EKS Pod Identity) |
| OTLP endpoint URL, instance ID (not secret) | SSM String `/cashight/grafana-cloud/otlp-endpoint`, `/cashight/grafana-cloud/instance-id` | Collector init container |
| Grafana service-account token, Synthetic Monitoring token | `terraform/grafana/terraform.tfvars` (gitignored) on the workstation only | `terraform/grafana/` |
| Slack webhook URL | SSM SecureString `/cashight/grafana/slack-webhook-url` | `terraform/grafana/` (data source) |

There is no Kubernetes Secret: the init container copies the three parameters
into a memory-backed volume, and the collector config reads them with
`${file:/secrets/...}`. The collector side lives in
`deploy/platform/config/addons/opentelemetry-collector.yaml`; check it with
`bash scripts/platform/check-collector.sh`.

## 2. One-time setup (about 15 minutes)

1. **Stack.** In the Grafana Cloud portal, create a stack in a **Singapore**
   region cluster. Record its slug (`<slug>.grafana.net`).
2. **OTLP write token.** Portal → *Access Policies* → create
   `cashight-otlp-write`, realm = the stack, scopes `metrics:write`,
   `logs:write`, `traces:write`. Add a token to it.
3. **OTLP endpoint and instance ID.** Portal → the stack → *OpenTelemetry* →
   *Configure*. Copy the endpoint (`https://otlp-gateway-…grafana.net/otlp`)
   and the instance ID (a number).
4. **Terraform service account.** In the stack's Grafana → *Administration →
   Users and access → Service accounts* → add `terraform-cashight` with role
   **Admin** (it manages the notification policy) → add a token.
5. **Synthetic Monitoring.** In the stack's Grafana → *Testing & synthetics →
   Synthetics* → initialise it. On its *Config* page, generate an access token
   and copy the API URL: `https://synthetic-monitoring-api-<region>.grafana.net`,
   not the `-grpc-` backend address the same page shows for private probes.
6. **Slack.** Create an incoming webhook for the alerts channel
   (api.slack.com → *Your apps* → an app with *Incoming Webhooks* → *Add New
   Webhook*).
7. **SSM parameters.** Secrets are read with `read -rs`, so they never land in
   shell history:

   Replace `<endpoint>` and `<instance id>`, brackets included. Add
   `--overwrite` to correct a value; to purge a secret pasted into the wrong
   parameter, `delete-parameter` and put it again, since SSM keeps old versions.

   ```bash
   read -rs VALUE && aws ssm put-parameter --region ap-southeast-1 --type SecureString \
     --name /cashight/grafana-cloud/otlp-token --value "$VALUE" && unset VALUE
   aws ssm put-parameter --region ap-southeast-1 --type String \
     --name /cashight/grafana-cloud/otlp-endpoint --value "<endpoint>"
   aws ssm put-parameter --region ap-southeast-1 --type String \
     --name /cashight/grafana-cloud/instance-id --value "<instance id>"
   read -rs VALUE && aws ssm put-parameter --region ap-southeast-1 --type SecureString \
     --name /cashight/grafana/slack-webhook-url --value "$VALUE" && unset VALUE
   ```

   Check: the following prints `4`.

   ```bash
   aws ssm get-parameters --region ap-southeast-1 --query 'length(Parameters)' --names \
     /cashight/grafana-cloud/otlp-token /cashight/grafana-cloud/otlp-endpoint \
     /cashight/grafana-cloud/instance-id /cashight/grafana/slack-webhook-url
   ```

8. **tfvars.** `cp terraform/grafana/terraform.tfvars.example terraform/grafana/terraform.tfvars`
   and fill it in from steps 1, 4 and 5.

## 3. Applying `terraform/grafana/`

Applied from the workstation only, because the Grafana tokens exist only here.
CI runs `fmt -check`, `validate`, `test` and `tflint` on it and never applies.

```bash
cd terraform/grafana
eval "$(aws configure export-credentials --format env)"   # aws login session -> env for Terraform
terraform init        # backend.tf is complete: bucket cashight-tfstate, key cashight/grafana/terraform.tfstate
terraform plan
terraform apply
```

Do not pass `-backend-config=../backend.hcl`: that file belongs to the main root
and would point this root at the main root's state key.

After the first apply, send a test notification: Grafana → *Alerting → Contact
points* → `slack-cashight` → *Test*.

First applied 2026-11-02 (stack `cashight`, Singapore): 4 resources, the check
disabled. Slack test notification received 2026-11-02.

## 4. Rotating a token

- **OTLP write token:** create a new token on the access policy, overwrite the
  parameter (`aws ssm put-parameter … --overwrite`), then
  `kubectl -n observability rollout restart daemonset/otel-collector-agent`.
  Delete the old token once the collector logs show no `401`.
- **Terraform or Synthetic Monitoring token:** replace it in `terraform.tfvars`.
- **Slack webhook:** overwrite `/cashight/grafana/slack-webhook-url`, then
  `terraform apply`.

## 5. Local verification run

Proves the app's telemetry reaches the stack and stays private, without a
cluster. Needs Docker and AWS credentials.

1. **Collector**. It reads the same three SSM parameters
   as the in-cluster init container and listens on `localhost:4318`:

   ```bash
   LOG_DIR=$(mktemp -d) && echo "$LOG_DIR"
   GRAFANA_CLOUD_PARAMETER_PATH=/cashight/grafana-cloud ./scripts/platform/run-local-collector.sh "$LOG_DIR"
   ```

   Wait for `Everything is ready. Begin running and processing data.` and no
   `401` or `403` from `otlp_http`. Without `GRAFANA_CLOUD_PARAMETER_PATH` the
   script reads `terraform/platform`'s output, or falls back to
   `/cashight/grafana-cloud` while no cluster state exists.

2. **Drill**, in `cashight`, in a second terminal with the same `LOG_DIR`:

   ```bash
   pnpm tsx scripts/local/telemetry-drill.ts --minutes 3 --rps 1 --error-ratio 0.1 \
     --failed-jobs 1 --log-file "$LOG_DIR/drill.log"
   ```

   Exits 0, and `$LOG_DIR/collected.jsonl` grows during the run.

3. **Audit** what the collector exported:

   ```bash
   pnpm tsx scripts/local/telemetry-audit.ts "$LOG_DIR/collected.jsonl"; echo "exit=$?"
   ```

   Expect `0 findings` and `exit=0`. A finding means an attribute or value
   left the collector that should not have: fix the app if it emitted it, or
   the allowlist if the collector added it, with a regression test.

4. **Grafana Explore** (or the data source proxy API with the
   `terraform-cashight` token):
   - Prometheus: `count by (service_name) (http_server_request_duration_seconds_count)`
     and the same for `cashight_worker_jobs_total` cover the four service names.
   - Tempo: `{name="GET dashboard"}` and `{name="worker.job"}` return traces.
   - Loki: `{k8s_namespace_name="cashight"} |= "drill request"`; the line's
     `trace_id` opens the same trace in Tempo.
   - Series labels are only those in section 6 plus `job`, `le`,
     `http_request_method` and `service_*`.
   - `count({__name__=~".+"})` is in the low hundreds, far below 10k.

Last run 2026-11-02: drill 164 ok and 16 deliberate errors, audit 0
findings, all four Explore checks passed.

## 6. Recorded metric names

OTLP names as Grafana Cloud's Prometheus stores them, from the run of
2026-11-02. `terraform/grafana/metrics.tf` holds them; alert rules and the
dashboard reference only its keys.

| Key | Prometheus name | Source |
|---|---|---|
| `metric.http_count`, `metric.http_bucket` | `http_server_request_duration_seconds_count`, `…_bucket` | observed |
| `metric.http_responses` | `cashight_http_server_responses_total`, status class in `outcome` | observed on EKS, 2026-11-08 |
| `metric.worker_jobs` | `cashight_worker_jobs_total` | observed |
| `metric.worker_duration_bucket` | `cashight_worker_job_duration_seconds_bucket` | observed |
| `metric.invoice_parse_failures` | `cashight_aws_invoice_parse_failure_total` | derived; the drill emits none |
| `metric.collector_uptime` | `otelcol_process_uptime_total` | observed |
| `metric.container_restarts`, `pod_cpu`, `pod_memory`, `node_memory`, `container_memory_limit` | `k8s_container_restarts`, `k8s_pod_cpu_usage`, `k8s_pod_memory_working_set_bytes`, `k8s_node_memory_working_set_bytes`, `k8s_container_memory_limit_bytes` | observed on EKS, 2026-11-08. `k8s_container_*` come from the `k8s_cluster` receiver, which reports nothing without its ClusterRole reads (`services`, `replicationcontrollers`, `resourcequotas`, `cronjobs`, `horizontalpodautoscalers`) |
| `label.status`, `route`, `outcome`, `error_code`, `service` | `http_response_status_code`, `http_route`, `outcome`, `error_code`, `service_name` | observed, except `error_code` |
| `label.namespace`, `label.pod` | `k8s_namespace_name`, `k8s_pod_name` | observed on metrics and Loki streams on EKS, 2026-11-08 |

Series count after the run: 126 of the free tier's 10,000.

## 7. Alerts

Five rules in the `cashight-v2` group (`terraform/grafana/alerts.tf`), folder
*Cashight v2*, evaluated every minute, all to `slack-cashight`. Each critical rule is paused
until what it watches exists, because it would fire permanently before then:
**Telemetry stopped** until `collector_live`, **API down** until `api_live`.
They are separate switches so a collector outage between the two still pages.

### API down (critical, fires at once, no data fires)

The synthetic check has not reached `/health` from Singapore or Tokyo for
6 minutes.

1. The node exists: `kubectl get nodes`. A Spot interruption replaces it; see
   the EC2 console's Spot interruption events for the account.
2. The API pods are running: `kubectl -n cashight get pods`.
3. The ALB's target health for the API target group, then DNS for
   `api.cashight-v2.nghuy.link`.

### Telemetry stopped (critical, fires at once, no data fires)

No collector has reported uptime for 10 minutes. Either the cluster is gone or
the collector is broken; both mean the other rules are blind.

1. The node exists: `kubectl get nodes`.
2. The collector: `kubectl -n observability get ds otel-collector-agent` and
   its pod's logs. An init-container failure names the SSM parameter it could
   not read.
3. A `401` or `403` from `otlp_http` in the collector log means the OTLP token
   was revoked or rotated: see section 4.

### API errors (warning, after 5 minutes)

More than 5% of API requests answered 5xx over 10 minutes, counted only when at
least 20 requests were made, so one failure at night does not page.

The rule reads `cashight_http_server_responses_total`, not the duration
histogram. Every API pod creates that counter's four series (`outcome` =
`2xx`, `3xx`, `4xx`, `5xx`) at 0 and exports them before it listens, so the
first 5xx on a new pod is an `increase()`. Histogram series appear only with
their first request per route and status, and would drop it.

1. Which route: in Explore, `sum by (http_route) (increase(http_server_request_duration_seconds_count{http_response_status_code=~"5.."}[10m]))`.
2. The trace: Tempo, `{status=error}` for the API service, then the logs
   linked from the span.
3. Dependencies: DynamoDB and S3 throttling or errors in CloudWatch, and the
   Cognito JWKS (the API answers 503 when it cannot fetch keys).

### Parse jobs failing (warning, after 5 minutes)

A statement or invoice parse job ended `failed` or `timed_out` in the last 15
minutes.

1. Which worker and outcome: `sum by (service_name, outcome) (increase(cashight_worker_jobs_total{outcome!="succeeded"}[15m]))`.
2. The job's log: Loki, `{k8s_namespace_name="cashight"} |= "job"` around that
   time, then the linked trace. `UNSUPPORTED_BANK` or a reconciliation error is
   a statement problem, not a platform one.
3. The message is redelivered by SQS; check the dead-letter queue if it keeps
   failing.

The job counter starts at 0 for every outcome when a worker starts, and the
worker exports it (`telemetry.flush()`) before it polls, so even a failure in
the first seconds after a scale-from-zero start is seen.

### Pod crash-looping (warning, after 5 minutes)

A pod in `cashight`, `observability` or `keda` restarted 3 or more times in 15
minutes.

1. `kubectl -n <namespace> describe pod <pod>`: last state, exit code,
   `OOMKilled`.
2. `kubectl -n <namespace> logs <pod> --previous`.
3. Memory against limits: the dashboard's memory panel, then the node's
   headroom.

### Alert drill

Rules 3 and 4 fired and resolved against the local collector (section 5,
step 1), and the low-volume guard of rule 3 held. Times are UTC and are
Grafana's rule state; Slack received a message for each firing and resolved
transition, grouped by alertname.

| Step | Drill | Traffic | Result |
|---|---|---|---|
| Fire, 2026-11-03 00:07–00:19 | `--minutes 12 --rps 1 --error-ratio 0.2 --failed-jobs 3` | 601 ok, 117 5xx | both pending 00:09:55, firing 00:15:03 |
| Resolve, 2026-11-03 00:19–00:39 | `--minutes 20 --error-ratio 0 --failed-jobs 0` | 1196 ok | **Parse jobs failing** resolved 00:24:47, **API errors** 00:27:52 |
| Low-volume guard, 2026-11-04 15:04–15:14 | `--minutes 10 --rps 0.03 --error-ratio 0.5 --failed-jobs 0` | 9 ok, 9 5xx | stayed inactive; 10-minute `increase` peaked at 15.7 requests, under the 20 minimum; no Slack message |

Rules 1 and 5 fired and resolved on the first EKS test day, 2026-11-08 (UTC),
both routed to `slack-cashight`:

| Rule | Drill | Pending | Firing | Resolved |
|---|---|---|---|---|
| **API down** | `cashight-api` Rollout scaled to 0 at 04:30:43 | (critical, no pending) | 04:36:40 | 04:38:40, about 1 min after the API was back |
| **Pod crash-looping** | a pod in `cashight` running `exit 1` under `restartPolicy: Always`, from 04:37:49 | 04:41:40 | 04:46:40 | 04:54:40, after the pod was deleted |

To take the API down for a drill, annotate the Application first:
`kubectl -n argocd annotate application cashight argocd.argoproj.io/skip-reconcile=true`.
Then scale the Rollout. Do not turn `selfHeal` off instead: the
`platform-workloads` app-of-apps re-syncs the Application and turns it back on,
which scales the API up again within minutes. Remove the annotation
(`…skip-reconcile-`) to restore the API.

Run the low-volume step only after at least 10 minutes without traffic. Run
straight after the resolve step, the window still holds its tail: on
2026-11-03 at 00:48 it counted 69 requests, 6 of them 5xx, and the rule went
pending for a minute until that traffic aged out.

## 8. Going live (Plan 4)

The cluster is a test environment that exists only during a test day, so
`api_live` and `collector_live` stay `false` in `terraform.tfvars`.
`scripts/platform/bring-up.sh` applies this root with `-var api_live=true
-var collector_live=true` once smoke passes, and `teardown.sh` applies it with
both `false` before anything is deleted ([platform runbook](platform.md)).
`api_live` enables the synthetic check and unpauses **API down**;
`collector_live` unpauses **Telemetry stopped**.
