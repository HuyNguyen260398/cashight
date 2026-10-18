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
| OTLP write token (`metrics:write`, `logs:write`, `traces:write`) | SSM SecureString `/aws-eks-infra/platform/grafana-cloud/otlp-token` | Collector init container (EKS Pod Identity) |
| OTLP endpoint URL, instance ID (not secret) | SSM String `/aws-eks-infra/platform/grafana-cloud/otlp-endpoint`, `/aws-eks-infra/platform/grafana-cloud/instance-id` | Collector init container |
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
   and copy the API URL.
6. **Slack.** Create an incoming webhook for the alerts channel
   (api.slack.com → *Your apps* → an app with *Incoming Webhooks* → *Add New
   Webhook*).
7. **SSM parameters.** Secrets are read with `read -rs`, so they never land in
   shell history:

   ```bash
   read -rs VALUE && aws ssm put-parameter --region ap-southeast-1 --type SecureString \
     --name /aws-eks-infra/platform/grafana-cloud/otlp-token --value "$VALUE" && unset VALUE
   aws ssm put-parameter --region ap-southeast-1 --type String \
     --name /aws-eks-infra/platform/grafana-cloud/otlp-endpoint --value "<endpoint>"
   aws ssm put-parameter --region ap-southeast-1 --type String \
     --name /aws-eks-infra/platform/grafana-cloud/instance-id --value "<instance id>"
   read -rs VALUE && aws ssm put-parameter --region ap-southeast-1 --type SecureString \
     --name /cashight/grafana/slack-webhook-url --value "$VALUE" && unset VALUE
   ```

   Check: the following prints `4`.

   ```bash
   aws ssm get-parameters --region ap-southeast-1 --query 'length(Parameters)' --names \
     /aws-eks-infra/platform/grafana-cloud/otlp-token /aws-eks-infra/platform/grafana-cloud/otlp-endpoint \
     /aws-eks-infra/platform/grafana-cloud/instance-id /cashight/grafana/slack-webhook-url
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

## 4. Rotating a token

- **OTLP write token:** create a new token on the access policy, overwrite the
  parameter (`aws ssm put-parameter … --overwrite`), then
  `kubectl -n observability rollout restart daemonset/otel-collector-agent`.
  Delete the old token once the collector logs show no `401`.
- **Terraform or Synthetic Monitoring token:** replace it in `terraform.tfvars`.
- **Slack webhook:** overwrite `/cashight/grafana/slack-webhook-url`, then
  `terraform apply`.

## 5. Local verification run

Filled in by Plan 3 Task 8.

## 6. Recorded metric names

Filled in by Plan 3 Task 8.

## 7. Alerts

Filled in by Plan 3 Task 9.

## 8. Going live (Plan 4)

Once `https://api.cashight-v2.nghuy.link/health` serves, set `api_live = true` in
`terraform.tfvars` and apply. That enables the synthetic check and unpauses
**API down** and **Telemetry stopped**.
