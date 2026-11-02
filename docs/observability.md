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
| OTLP write token (`metrics:write`, `logs:write`, `traces:write`) | SSM SecureString `/platform/aws-eks-infra/grafana-cloud/otlp-token` | Collector init container (EKS Pod Identity) |
| OTLP endpoint URL, instance ID (not secret) | SSM String `/platform/aws-eks-infra/grafana-cloud/otlp-endpoint`, `/platform/aws-eks-infra/grafana-cloud/instance-id` | Collector init container |
| Grafana service-account token, Synthetic Monitoring token | `terraform/grafana/terraform.tfvars` (gitignored) on the workstation only | `terraform/grafana/` |
| Slack webhook URL | SSM SecureString `/cashight/grafana/slack-webhook-url` | `terraform/grafana/` (data source) |

There is no Kubernetes Secret: the init container copies the three parameters
into a memory-backed volume, and the collector config reads them with
`${file:/secrets/...}`. The collector side lives in `aws-eks-infra`
(`gitops/platform/config/addons/opentelemetry-collector.yaml`; check it with
`make collector-check` there).

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
     --name /platform/aws-eks-infra/grafana-cloud/otlp-token --value "$VALUE" && unset VALUE
   aws ssm put-parameter --region ap-southeast-1 --type String \
     --name /platform/aws-eks-infra/grafana-cloud/otlp-endpoint --value "<endpoint>"
   aws ssm put-parameter --region ap-southeast-1 --type String \
     --name /platform/aws-eks-infra/grafana-cloud/instance-id --value "<instance id>"
   read -rs VALUE && aws ssm put-parameter --region ap-southeast-1 --type SecureString \
     --name /cashight/grafana/slack-webhook-url --value "$VALUE" && unset VALUE
   ```

   Check: the following prints `4`.

   ```bash
   aws ssm get-parameters --region ap-southeast-1 --query 'length(Parameters)' --names \
     /platform/aws-eks-infra/grafana-cloud/otlp-token /platform/aws-eks-infra/grafana-cloud/otlp-endpoint \
     /platform/aws-eks-infra/grafana-cloud/instance-id /cashight/grafana/slack-webhook-url
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
cluster. Needs Docker, AWS credentials and both checkouts side by side.

1. **Collector**, in `aws-eks-infra`. It reads the same three SSM parameters
   as the in-cluster init container and listens on `localhost:4318`:

   ```bash
   LOG_DIR=$(mktemp -d) && echo "$LOG_DIR"
   PARAMETER_PREFIX=/platform/aws-eks-infra ./scripts/run-local-collector.sh "$LOG_DIR"
   ```

   Wait for `Everything is ready. Begin running and processing data.` and no
   `401` or `403` from `otlp_http`. `PARAMETER_PREFIX` is needed until the
   platform root has been applied; after that the script reads its output.

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
| `metric.worker_jobs` | `cashight_worker_jobs_total` | observed |
| `metric.worker_duration_bucket` | `cashight_worker_job_duration_seconds_bucket` | observed |
| `metric.invoice_parse_failures` | `cashight_aws_invoice_parse_failure_total` | derived; the drill emits none |
| `metric.collector_uptime` | `otelcol_process_uptime_total` | observed |
| `metric.container_restarts`, `pod_cpu`, `pod_memory`, `node_memory`, `container_memory_limit` | `k8s_container_restarts`, `k8s_pod_cpu_usage`, `k8s_pod_memory_working_set_bytes`, `k8s_node_memory_working_set_bytes`, `k8s_container_memory_limit_bytes` | unverified until Plan 4 |
| `label.status`, `route`, `outcome`, `error_code`, `service` | `http_response_status_code`, `http_route`, `outcome`, `error_code`, `service_name` | observed, except `error_code` |
| `label.namespace`, `label.pod` | `k8s_namespace_name`, `k8s_pod_name` | `k8s_namespace_name` observed on Loki streams; both unverified on metrics until Plan 4 |

Series count after the run: 126 of the free tier's 10,000.

## 7. Alerts

Filled in by Plan 3 Task 9.

## 8. Going live (Plan 4)

Once `https://api.cashight-v2.nghuy.link/health` serves, set `api_live = true` in
`terraform.tfvars` and apply. That enables the synthetic check and unpauses
**API down** and **Telemetry stopped**.
