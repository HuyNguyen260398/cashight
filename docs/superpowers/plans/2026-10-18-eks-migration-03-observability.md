# EKS Migration, Plan 3 of 5: Observability — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Write and validate the OpenTelemetry Collector add-on and its IAM in `aws-eks-infra`, and apply the Grafana Cloud side in `cashight` (Slack alerts, five alert rules, a synthetic `/health` check, one dashboard), proven end to end by a local collector run against the free stack.

**Architecture:** In `aws-eks-infra`, Terraform adds the collector's Pod Identity role and association. GitOps adds an Argo CD ApplicationSet that installs the upstream `opentelemetry-collector` chart as a DaemonSet, plus a small kustomization for the `observability` namespace and lease Role. A render script turns that ApplicationSet into plain manifests and two collector configs (cluster and local), which `make collector-check` asserts on and validates with `otelcol-contrib validate`. In `cashight`, a new Terraform root `terraform/grafana/` owns everything in Grafana Cloud. A local telemetry drill drives Plan 1's instrumented HTTP server and SQS consumer, so real metrics, spans and logs reach the stack before the cluster exists.

**Tech Stack:** OpenTelemetry Collector contrib (Helm chart `open-telemetry/opentelemetry-collector`), Argo CD ApplicationSets (multi-source), Kustomize, EKS Pod Identity, AWS SSM Parameter Store, Terraform ≥ 1.11 (`grafana/grafana` and `hashicorp/aws` providers, `terraform test` with mock providers), Grafana Cloud free tier (Mimir, Loki, Tempo, Synthetic Monitoring, Grafana-managed alerting), Slack incoming webhook, bash + `yq` (mikefarah v4) + `jq`, Docker, TypeScript + vitest.

**Spec:** `docs/superpowers/specs/2026-10-18-eks-observability-design.md`. It replaces §4.6 and the metrics-based analysis in §4.5 of `docs/superpowers/specs/2026-10-08-eks-migration-design.md`.

## Where this plan sits

| Plan | Phases (migration spec §5) | Repo |
|---|---|---|
| 1. Backend container runtime | 3 | `cashight` (**done**, PR #135) |
| 2. Prerequisites and platform capacity | 0, 1 | `cashight`, `aws-eks-infra` (code merged, `aws-eks-infra` #17; cluster not created) |
| **3. Observability (this plan)** | 2 | `aws-eks-infra`, `cashight` |
| 4. Cashight AWS resources, GitOps manifests, image pipeline, v2 SPA | 4, 5 | both |
| 5. Parallel run, retire, rename | 6, 7 | `cashight` |

**State on 2026-10-18:** the EKS cluster does not exist and `enable_argocd = false`. Nothing under `gitops/` runs until Plan 4. No Grafana Cloud stack exists yet. Task 7 creates it.

## Branching and where each task runs

| Tasks | Repo | Branch | PR into |
|---|---|---|---|
| 1–4 | `aws-eks-infra` | `feat/observability`, cut from `main` | `main` |
| 5–11 | `cashight` | `feat/eks-observability`, cut from `cashight-v2` | `cashight-v2` (never `main`) |

Run the `aws-eks-infra` tasks first: Task 8 runs the collector config rendered by Task 3. In `aws-eks-infra`, use one Conventional Commit per task and put the exact validation commands in the PR description. Run `make terraform-check` for `.tf` changes, `make yaml-check` and `make collector-check` for `gitops/` changes, and `make shell-check` for `scripts/` changes.

## Global Constraints

- Backend is the **Grafana Cloud free tier**: 10k metric series, 50 GB logs, 50 GB traces, 14-day retention, $0. Create the stack in a Singapore-region Grafana Cloud cluster.
- Telemetry adds **no AWS cost** beyond the collector pod. In-cluster footprint is **one collector pod, requests 100m CPU / 128Mi, limit 256Mi**. `memory_limiter` is set below the limit.
- Collector: upstream `opentelemetry-collector` chart, image `otel/opentelemetry-collector-contrib`, `mode: daemonset`, namespace `observability`, Argo CD add-on under `gitops/platform/config/addons`. **No OpenTelemetry Operator, no gateway.** Chart and image versions are pinned.
- Service DNS name and port: `otel-collector.observability:4318`, OTLP/HTTP only (no gRPC).
- Processor order: `memory_limiter` → `k8sattributes` → allowlist → `batch`. `k8sattributes` extracts only `k8s.namespace.name`, `k8s.pod.name`, `k8s.container.name`, `k8s.node.name`. No labels, no annotations.
- Collector runs as **UID 0**, all capabilities dropped, read-only root filesystem, read-only hostPath mounts. The namespace is Pod Security `privileged` and has **no default-deny NetworkPolicy**.
- **Privacy:** no PAN, transaction description, cardholder name, email or token in any log line, span attribute or metric label.
- **No Kubernetes Secret and nothing secret in Git.** Tokens reach the collector through an init container (AWS CLI image, EKS Pod Identity) writing to a memory-backed `emptyDir`, read with `${file:/secrets/...}`.
- SSM names: `/aws-eks-infra/platform/grafana-cloud/otlp-token` (SecureString), `/aws-eks-infra/platform/grafana-cloud/otlp-endpoint` and `/aws-eks-infra/platform/grafana-cloud/instance-id` (String), `/cashight/grafana/slack-webhook-url` (SecureString). All are created by hand, so no value enters Terraform state, except the Slack URL, which `terraform/grafana/` reads as a data source.
- `terraform/grafana/` is a new root with its own state key in the `cashight-tfstate` bucket. It is applied **from the workstation only**. CI runs only `fmt -check`, `validate -backend=false`, `test` and `tflint` on it. The existing roots stay untouched.
- Alert folder `Cashight v2`. Dashboard `Cashight v2` lives at `terraform/grafana/dashboards/cashight-v2.json`.
- Synthetic check: `https://api.cashight-v2.nghuy.link/health`, every 2 min (120000 ms), probes Singapore and Tokyo, expects HTTP 200 within 5 s (5000 ms).
- Notification policy: group by `alertname`, group wait 30s, group interval 5m, repeat interval 4h, resolved messages on.
- `api_live` (bool, default `false`): when false, the check is created **disabled** and rules 1 and 2 are **paused**. Rules 3–5 are always active.
- PromQL metric and label names come from the local verification run (Task 8), **not from guesses**.
- Plan 3 changes no application code, unless Task 8 finds an attribute that breaks the privacy rules or the series budget.
- `aws-eks-infra` ownership invariant: Terraform owns AWS resources, Argo CD owns `gitops/`, and nothing is managed by both. New Terraform-to-GitOps values travel as cluster-Secret annotations. Never hardcode account values in YAML.

## Departures from the spec (decided while writing this plan)

1. **Local run uses a telemetry drill, not `pnpm dev:local`.** `scripts/dev-server.ts` imports only `matchRoute`. It never calls `startTelemetry`, `createApiServer` or `createSqsConsumer`, so pointing it at a collector emits nothing. `scripts/local/telemetry-drill.ts` (Task 5) runs Plan 1's real `createApiServer` and `createSqsConsumer` with fake auth and queue dependencies. It also produces the 5xx and failed-job traffic that fires rules 3 and 4, replacing "a failing route, a non-PDF upload".
2. **One allowlist processor.** The allowlist is `transform/allowlist` (OTTL `keep_keys` and `keep_matching_keys`). OTTL covers resource, span, data-point and log levels, so the separate `attributes` processor is not needed. Data-point attributes are allowlisted only for Cashight's own metrics (`resource.attributes["service.namespace"] == "cashight"`). Infra receivers emit fixed attribute sets such as `state` and `direction`, and stripping those would merge distinct series into colliding ones.
3. **Self-monitoring keeps only `otelcol_process_.*`.** Those metrics carry no labels, so the allowlist cannot collide them, and rule 2 needs only uptime.
4. **k8s resource attributes are copied onto data points** for `k8s.*` and `container.*` metrics. Rule 5 and the dashboard then filter on `k8s_namespace_name` whether or not Grafana Cloud promotes resource attributes to labels.
5. **The `observability` Namespace (with its Pod Security label) and the leader-election lease Role** come from a second Application source, `gitops/platform/config/observability/`. The chart only creates cluster-scoped RBAC, and `CreateNamespace` cannot set labels on its own.
6. **New cluster-Secret annotation `platform_parameter_prefix`** (e.g. `/aws-eks-infra/platform`), so the init container's SSM paths are not hardcoded in YAML.
7. **Log-to-trace link through a dashboard data link**, not a Loki datasource derived field. The stack's provisioned datasources are not edited. The logs panel is a table with a `trace_id` field whose data link opens Tempo.
8. **Rule 1 treats no data as firing.** The spec is silent here. A check that stops reporting is itself a broken uptime signal.
9. **`tf-ci.yaml` also runs on PRs into `cashight-v2`**, otherwise `terraform/grafana/` is never checked before Plan 5's merge to `main`.

## Review Focus

These conditions are implied by the spec but not exercised by any rendered-config assertion. Each one has a test in the task that owns it.

1. **A missing or empty SSM parameter starts the collector with an empty token.** It would then retry 401s forever while `otelcol_process_uptime` keeps flowing, so rule 2 stays quiet. Expected: the init container exits non-zero and names the parameter. Owner: Task 2 (init command `test -s`), Task 3 Step 6 (local run against a wrong prefix exits non-zero).
2. **Sensitive text in log bodies.** `filelog` forwards bodies unchanged, and the allowlist only strips attributes. Expected: the drill's collected output contains no email, 13–19-digit run or `Bearer` token, even though the drill logs such values through `logger`. Owner: Task 5 (`findSensitiveValues` tests and drill log fields), Task 8 (run).
3. **Rule 2 firing permanently before the cluster exists.** Expected: with `api_live = false`, rules 1 and 2 are paused and the check is disabled. With `true`, all three are active. Owner: Task 6 (check), Task 9 (rules).
4. **Rule 3 firing on a trickle.** One error in two requests is 50 %. Expected: no alert under 20 requests in 10 min. Owner: Task 9 (query has the `>= 20` guard), Task 11 Step 3 (low-volume drill stays Normal).
5. **The collector OOM-killed on a full 4 GiB node.** Expected: `memory_limiter` limits below the 256Mi container limit, so data is refused before the kernel kills the pod. Owner: Task 3 (`check-collector.sh` asserts `limit_mib + spike_limit_mib` stays under the limit's MiB).

---

## File map

### `aws-eks-infra` (Tasks 1–4)

| File | Task | Responsibility |
|---|---|---|
| `modules/platform_cluster/iam_pod_identity.tf` | 1 | Collector role, SSM + KMS-via-SSM policy, Pod Identity association `observability/otel-collector` |
| `modules/platform_cluster/variables.tf`, `outputs.tf` | 1 | `grafana_cloud_parameter_path` input, `otel_collector_role_arn` output |
| `environments/platform/main.tf`, `outputs.tf` | 1 | Pass the path; surface the role ARN |
| `modules/platform_cluster_bootstrap/kubernetes.tf`, `variables.tf` | 1 | `platform_parameter_prefix` cluster-Secret annotation |
| `gitops/platform/config/addons/opentelemetry-collector.yaml` (new) + `kustomization.yaml` | 2, 3 | Collector ApplicationSet (chart source + observability source) |
| `gitops/platform/config/observability/{kustomization,namespace,lease-role}.yaml` (new) | 2 | Namespace with Pod Security label; Role + RoleBinding for leases |
| `scripts/render-collector.sh` (new) | 2, 3 | ApplicationSet → manifests, cluster config, local config |
| `scripts/check-collector.sh` (new) | 2, 3 | Assertions on the render + `otelcol-contrib validate` |
| `scripts/run-local-collector.sh` (new) | 3 | Run the local config in Docker with tokens from SSM |
| `Makefile`, `.github/workflows/yaml-ci.yaml` | 2 | `collector-check` target and CI step |
| `scripts/verify-platform.sh` | 4 | Association, namespace, DaemonSet, no Secret |
| `CLAUDE.md`, `AGENTS.md`, `README.md`, `docs/operations/{validate-platform,deploy-platform}.md` | 4 | Telemetry is decided; point to Cashight's runbook |

### `cashight` (Tasks 5–11)

| File | Task | Responsibility |
|---|---|---|
| `scripts/local/telemetry-drill.ts` (new) | 5 | Drive the real HTTP server and SQS consumer with telemetry on |
| `scripts/local/telemetry-audit.ts` (new) + `scripts/__tests__/telemetry-audit.test.ts` | 5 | Allowlist and sensitive-value audit of collector file output |
| `terraform/grafana/{versions,backend,providers,variables,data,notifications,uptime}.tf`, `terraform.tfvars.example`, `.terraform.lock.hcl` (new) | 6 | Root, folder, Slack contact point, policy, synthetic check |
| `terraform/grafana/tests/*.tftest.hcl` (new) | 6, 9, 10 | Mock-provider tests |
| `.github/workflows/tf-ci.yaml` | 6 | `cashight-v2` trigger; `grafana` job |
| `docs/observability.md` (new) | 7, 8, 11 | Runbook: manual setup, local run, recorded names, drills |
| `terraform/grafana/metrics.tf` (new) | 8 | Recorded PromQL metric and label names (single source) |
| `terraform/grafana/alerts.tf` (new) | 9 | Rule group with the five rules |
| `terraform/grafana/dashboard.tf`, `dashboards/cashight-v2.json` (new) | 10 | Dashboard |
| `docs/container-runtime.md`, `docs/superpowers/specs/2026-10-08-eks-migration-design.md` | 11 | Endpoint name; §4.5, §4.6, open point 2 |

---

## Task 1: Collector IAM role, Pod Identity association, parameter-prefix annotation

**Repo:** `aws-eks-infra`. **Branch:** `feat/observability` from `main`.

**Files:**
- Modify: `modules/platform_cluster/iam_pod_identity.tf` (append after the KEDA association)
- Modify: `modules/platform_cluster/variables.tf`, `modules/platform_cluster/outputs.tf`
- Modify: `environments/platform/main.tf` (module call), `environments/platform/outputs.tf`
- Modify: `modules/platform_cluster_bootstrap/kubernetes.tf:12-19` (annotations), `modules/platform_cluster_bootstrap/variables.tf`, and the bootstrap module call in `environments/platform/main.tf`

**Interfaces:**
- Consumes: `data.aws_iam_policy_document.pod_identity_assume_role` (existing), `local.platform_parameter_prefix` in `environments/platform/published.tf` (existing, `/<resource_prefix>/platform`).
- Produces: IAM role `${local.cluster_name}-otel-collector`; association namespace `observability`, service account `otel-collector`; module output `otel_collector_role_arn`; cluster-Secret annotation `platform_parameter_prefix` = `local.platform_parameter_prefix`. Task 2 reads the annotation as `{{ .metadata.annotations.platform_parameter_prefix }}` and appends `/grafana-cloud/<name>`.

- [ ] **Step 1: Add `variable "grafana_cloud_parameter_path"` to `modules/platform_cluster/variables.tf`**

String, no default, validation `can(regex("^/[A-Za-z0-9_./-]+[^/]$", var.grafana_cloud_parameter_path))`. Description: "SSM path holding the Grafana Cloud OTLP parameters; the collector may read `<path>/*`." In `environments/platform/main.tf`, pass `grafana_cloud_parameter_path = "${local.platform_parameter_prefix}/grafana-cloud"`. Locals are file-agnostic, so the existing local in `published.tf` is used as is.

- [ ] **Step 2: Add the role, its inline policy and the association to `iam_pod_identity.tf`**

Follow the KEDA block's shape and comment style. Add a policy document `otel_collector` with two statements:
- `ReadGrafanaCloudParameters`: `ssm:GetParameter` on `arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter${var.grafana_cloud_parameter_path}/*`.
- `DecryptViaSsm`: `kms:Decrypt` on `arn:aws:kms:${var.aws_region}:${data.aws_caller_identity.current.account_id}:key/*`, condition `StringEquals kms:ViaService = ssm.${var.aws_region}.amazonaws.com`.

Then add `aws_iam_role.otel_collector` (trust `pod_identity_assume_role`), `aws_iam_role_policy.otel_collector`, and `aws_eks_pod_identity_association.otel_collector` (`namespace = "observability"`, `service_account = "otel-collector"`). The leading comment states that the SecureString is created by hand (Cashight `docs/observability.md`), so its value never enters state.

- [ ] **Step 3: Output and annotation**

Add `output "otel_collector_role_arn"` to the module and to `environments/platform/outputs.tf`. In `modules/platform_cluster_bootstrap`, add `variable "platform_parameter_prefix"` (string) and the annotation `platform_parameter_prefix = var.platform_parameter_prefix`, aligned with the existing annotation map. Pass `local.platform_parameter_prefix` from `environments/platform/main.tf`.

- [ ] **Step 4: Run the static gate**

Run: `make terraform-check`
Expected: exit 0, and four `Success! The configuration is valid.` lines from `terraform-validate`. If checkov flags the KMS statement, add an inline `#checkov:skip=CKV_...: <reason>` at the policy document. The reason is that the resource is scoped by `kms:ViaService` and the AWS-managed `aws/ssm` key has no stable ARN to name.

- [ ] **Step 5: Read-only plan (workstation, AWS credentials)**

Run: `eval "$(aws configure export-credentials --format env)" && terraform -chdir=environments/platform plan -lock=false -input=false | tail -5`
Expected: the add count is 3 higher than before this branch (Plan 2 recorded `73 to add`), with `0 to change, 0 to destroy`, and the new addresses are `aws_iam_role.otel_collector`, `aws_iam_role_policy.otel_collector` and `aws_eks_pod_identity_association.otel_collector`. The bootstrap module stays at `count = 0`, so the annotation adds nothing.

- [ ] **Step 6: Commit**

```bash
git add modules/platform_cluster modules/platform_cluster_bootstrap environments/platform
git commit -m "feat(platform): add the OpenTelemetry Collector Pod Identity role"
```

---

## Task 2: Collector add-on, workload shape (namespace, RBAC, pod, token delivery)

**Files:**
- Create: `gitops/platform/config/addons/opentelemetry-collector.yaml`
- Modify: `gitops/platform/config/addons/kustomization.yaml` (add the file)
- Create: `gitops/platform/config/observability/kustomization.yaml`, `namespace.yaml`, `lease-role.yaml`
- Create: `scripts/render-collector.sh`, `scripts/check-collector.sh`
- Modify: `Makefile` (`collector-check`, add to `.PHONY`), `.github/workflows/yaml-ci.yaml` (install `yq`, run `make collector-check`)

**Interfaces:**
- Consumes: annotations `aws_region`, `platform_parameter_prefix` (Task 1), `gitops_repo_url`, `gitops_revision`; the Task 1 association `observability/otel-collector`.
- Produces: `scripts/render-collector.sh <out-dir>` writes `<out-dir>/manifests.yaml` (helm output + kustomize output, concatenated) and `<out-dir>/config.yaml` (the collector config from the rendered ConfigMap's `relay` key). Task 3 adds `<out-dir>/config-local.yaml`. `scripts/check-collector.sh` renders into a temp dir, runs every assertion, prints `PASS <name>` / `FAIL <name> (got …)` lines like `verify-platform.sh`, and exits 1 on any failure. `make collector-check` runs it.

- [ ] **Step 1: Write `scripts/check-collector.sh` with the workload assertions**

Reuse `verify-platform.sh`'s `pass`, `fail_line`, `assert_eq` and `assert_empty` helpers, copied rather than sourced, because each script is standalone. Query the render with `yq`. Assertions:

| Name | Condition |
|---|---|
| `One DaemonSet otel-collector in observability` | exactly one `kind: DaemonSet`, name `otel-collector`, namespace `observability`; zero `Deployment` and `StatefulSet` |
| `No Secret rendered` | zero `kind: Secret` |
| `Service exposes only 4318` | Service `otel-collector` ports == `[4318]` |
| `Image is pinned contrib` | collector container image starts `otel/opentelemetry-collector-contrib:` and the tag is not `latest` or empty |
| `Resources` | requests `cpu: 100m`, `memory: 128Mi`; limits `memory: 256Mi` |
| `Hardened containers` | every container and init container has `runAsUser: 0`, `readOnlyRootFilesystem: true`, `allowPrivilegeEscalation: false`, `capabilities.drop == ["ALL"]` |
| `hostPath read-only` | every volumeMount whose volume is a `hostPath` has `readOnly: true`; hostPath paths ⊆ `{/var/log/pods}` |
| `Secrets in memory` | volume `secrets` is `emptyDir.medium: Memory`, mounted at `/secrets` in the init container (rw) and the collector (ro) |
| `Init fetches and checks` | init container image starts `public.ecr.aws/aws-cli/aws-cli:`; its command contains `otlp-token`, `otlp-endpoint`, `instance-id` and `test -s` |
| `ClusterRole read-only` | the rendered ClusterRole's verbs ⊆ `{get,list,watch}`; resources == `{pods,namespaces,nodes,nodes/stats,replicasets,deployments,statefulsets,daemonsets,jobs}` (core, `apps`, `batch`); no `secrets` |
| `Lease Role in observability` | Role in namespace `observability` on `coordination.k8s.io` `leases`, verbs `{get,list,watch,create,update,patch}`, bound to ServiceAccount `otel-collector` |
| `Namespace privileged` | Namespace `observability` has `pod-security.kubernetes.io/enforce: privileged` (and `audit`, `warn` the same) |
| `No NetworkPolicy` | zero `kind: NetworkPolicy` |

Also run `kubeconform -strict -summary -ignore-missing-schemas` on `manifests.yaml` and fail on a non-zero exit.

- [ ] **Step 2: Write `scripts/render-collector.sh`**

`set -euo pipefail`; one argument, the output dir. Steps:
1. From `gitops/platform/config/addons/opentelemetry-collector.yaml`, read `.spec.template.spec.sources[0]` `repoURL`, `chart`, `targetRevision` and `helm.values` with `yq`.
2. Replace the Go-template placeholders in the values with test values: `{{ .metadata.annotations.aws_region }}` → `ap-southeast-1`, `{{ .metadata.annotations.platform_parameter_prefix }}` → `/aws-eks-infra/platform`. Fail if any `{{` remains.
3. `helm template otel-collector <chart> --repo <repoURL> --version <targetRevision> --namespace observability -f <values>` > `manifests.yaml`, then append `kubectl kustomize gitops/platform/config/observability`.
4. Extract `.data.relay` of the ConfigMap that has one into `config.yaml`.

- [ ] **Step 3: Add the Makefile target and run it to see it fail**

Add `collector-check: ; ./scripts/check-collector.sh` and add it to `.PHONY`. Leave it out of `yaml-check`, since it needs Docker and network.
Run: `make collector-check`
Expected: FAIL, because `opentelemetry-collector.yaml` does not exist (yq read error, non-zero exit).

- [ ] **Step 4: Write the observability kustomization**

`namespace.yaml`: Namespace `observability` with the three Pod Security labels set to `privileged`. `lease-role.yaml`: the Role and RoleBinding from the Step 1 table, plus a comment that `k8s_leader_elector` needs them and that the chart only makes the ClusterRole. `kustomization.yaml` lists both.

- [ ] **Step 5: Write the ApplicationSet**

Copy `keda.yaml`'s skeleton: header comment, `goTemplate`, `missingkey=error`, cluster generator, automated `prune` + `selfHeal`, `ServerSideApply=true`. Name it `'{{ .name }}-opentelemetry-collector'`, destination namespace `observability`, and **no** `CreateNamespace`, because the second source owns the namespace. Use `sources:` with:
1. `repoURL: https://open-telemetry.github.io/opentelemetry-helm-charts`, `chart: opentelemetry-collector`, `targetRevision` set to the newest chart release published at least 14 days before this task starts (`helm search repo open-telemetry/opentelemetry-collector --versions`), `helm.releaseName: otel-collector`.
2. `repoURL: '{{ .metadata.annotations.gitops_repo_url }}'`, `targetRevision: '{{ .metadata.annotations.gitops_revision }}'`, `path: gitops/platform/config/observability`.

Helm values for this task (Task 3 adds `config`):
- `fullnameOverride: otel-collector`, `mode: daemonset`, `image.repository: otel/opentelemetry-collector-contrib`, `image.tag:` the chart's `appVersion`. `command.name: otelcol-contrib`.
- `serviceAccount.create: true`, `serviceAccount.name: otel-collector`. No role annotation, because Pod Identity binds by name.
- `clusterRole.create: true` with the Step 1 rules.
- `ports`: keep only `otlp-http` (4318) enabled. Disable `otlp`, `jaeger-*`, `zipkin` and `metrics`.
- `resources` and `securityContext` from the Step 1 table. Set the same values on `initContainers[0].securityContext`.
- `extraVolumes`: `varlogpods` (hostPath `/var/log/pods`, type `Directory`), `secrets` (emptyDir, medium Memory, `sizeLimit: 1Mi`), `aws-home` (emptyDir) for the AWS CLI's `HOME`. `extraVolumeMounts`: `varlogpods` → `/var/log/pods` read-only, `secrets` → `/secrets` read-only.
- `initContainers[0]`: name `fetch-grafana-cloud`, AWS CLI image pinned with the same 14-day rule, env `AWS_REGION: '{{ .metadata.annotations.aws_region }}'`, `HOME: /aws-home`, `PREFIX: '{{ .metadata.annotations.platform_parameter_prefix }}/grafana-cloud'`. Command `["/bin/sh", "-ec"]` with this script:

```sh
for p in otlp-token otlp-endpoint instance-id; do
  aws ssm get-parameter --name "$PREFIX/$p" --with-decryption \
    --query Parameter.Value --output text > "/secrets/$p"
  test -s "/secrets/$p" || { echo "empty SSM parameter $PREFIX/$p" >&2; exit 1; }
done
```

  Mounts: `secrets` rw, `aws-home` rw.
- A values comment explaining why the pod runs as UID 0: pod log files are root-owned `0640`.

- [ ] **Step 6: Run the check until it passes**

Run: `make collector-check`
Expected: every workload line `PASS`, and exit 0 (the Task 3 config assertions do not exist yet). Also run `make yaml-check`. Expected: exit 0. kustomize-check picks up the new kustomization, and yamllint passes on the new files.

- [ ] **Step 7: CI step**

In `yaml-ci.yaml`, after "Install YAML tools", install `yq` pinned to the newest v4 release at least 14 days old (`https://github.com/mikefarah/yq/releases/download/<v>/yq_linux_amd64` → `/usr/local/bin/yq`). Then add a step `run: make collector-check`. Ubuntu runners have Docker, which Task 3's validate needs.

- [ ] **Step 8: Commit**

```bash
git add gitops/platform/config scripts/render-collector.sh scripts/check-collector.sh Makefile .github/workflows/yaml-ci.yaml
git commit -m "feat(gitops): add the OpenTelemetry Collector DaemonSet add-on"
```

---

## Task 3: Collector pipeline config, validation, and the local variant

**Files:**
- Modify: `gitops/platform/config/addons/opentelemetry-collector.yaml` (helm values `config:`)
- Modify: `scripts/render-collector.sh` (emit `config-local.yaml`), `scripts/check-collector.sh` (config assertions + validate)
- Create: `scripts/run-local-collector.sh`

**Interfaces:**
- Consumes: Task 2's render outputs and `/secrets/{otlp-token,otlp-endpoint,instance-id}`.
- Produces:
  - `config.yaml`, the cluster pipeline.
  - `config-local.yaml`, the same pipeline minus the Kubernetes components. Its `filelog` reads `/var/log/local/*.log`, every pipeline also exports to `file/local` at `/var/log/local/collected.jsonl`, and logs get `k8s.namespace.name=cashight`.
  - `scripts/run-local-collector.sh <log-dir>`, which runs `config-local.yaml` in Docker on `localhost:4318` with `<log-dir>` mounted at `/var/log/local`, using tokens fetched from SSM. Task 8 uses it.

- [ ] **Step 1: Add the config assertions to `check-collector.sh`**

| Name | Condition on `config.yaml` |
|---|---|
| `Receivers` | keys of `.receivers` == `{otlp, filelog, kubeletstats, k8s_cluster, prometheus}` |
| `OTLP HTTP only` | `.receivers.otlp.protocols` keys == `{http}`, endpoint ends `:4318` |
| `filelog excludes itself` | `include == ["/var/log/pods/*/*/*.log"]`; `exclude` contains `/var/log/pods/observability_otel-collector*_*/*/*.log` |
| `k8s_cluster leader-elected` | `.receivers.k8s_cluster.k8s_leader_elector` set; `k8s_leader_elector` listed in `.service.extensions` |
| `Self-scrape keeps process metrics` | the prometheus receiver's only `metric_relabel_configs` entry keeps regex `otelcol_process_.*` |
| `Processor order` | every pipeline's `processors == [memory_limiter, k8sattributes, transform/allowlist, batch]` |
| `memory_limiter under limit` | `limit_mib + spike_limit_mib < 256` |
| `k8sattributes minimal` | `extract.metadata == [k8s.namespace.name, k8s.pod.name, k8s.container.name, k8s.node.name]`; no `labels`, no `annotations` |
| `One exporter, basicauth` | every pipeline's `exporters == [otlphttp]`; `otlphttp.auth.authenticator == basicauth/grafana`; `basicauth/grafana.client_auth.username == ${file:/secrets/instance-id}`, `password == ${file:/secrets/otlp-token}`, `otlphttp.endpoint == ${file:/secrets/otlp-endpoint}` |
| `No inline credentials` | `config.yaml` contains no string matching `glc_` or `eyJ` |

Then add **validate**. Write dummy `/secrets` files, a dummy in-cluster ServiceAccount dir (`token`, `namespace`, and a throwaway self-signed `ca.crt` from `openssl req -x509 -nodes -newkey rsa:2048 -days 1 -subj /CN=x`). Run `docker run --rm -e MY_POD_IP=0.0.0.0 -e K8S_NODE_NAME=x -e KUBERNETES_SERVICE_HOST=127.0.0.1 -e KUBERNETES_SERVICE_PORT=6443 -v …:/cfg:ro -v …:/secrets:ro -v …:/var/run/secrets/kubernetes.io/serviceaccount:ro <image from manifests> validate --config=/cfg/config.yaml`, then repeat for `config-local.yaml`. Each one is a `PASS`/`FAIL` line.

- [ ] **Step 2: Run to see it fail**

Run: `make collector-check`
Expected: `FAIL Receivers` and `FAIL Processor order`, among others, because the chart default config is still in place.

- [ ] **Step 3: Write the `config:` values**

The chart **merges** `config` over its defaults, so set the default `jaeger`, `zipkin` and `otlp.protocols.grpc` entries to `null`, and redefine every pipeline in full. Pinned settings:
- `extensions`: `health_check` (chart default), `basicauth/grafana` as in the Step 1 table, and `k8s_leader_elector` (`auth_type: serviceAccount`, `lease_name: otel-collector-k8s-cluster`, `lease_namespace: observability`).
- `receivers.filelog`: `include` and `exclude` as asserted, `start_at: end`, `include_file_path: true`, operators `[{type: container}]` (CRI parsing and `k8s.*` from the path).
- `receivers.kubeletstats`: `auth_type: serviceAccount`, `endpoint: https://${env:K8S_NODE_NAME}:10250`, `insecure_skip_verify: true`, `collection_interval: 60s`, `metric_groups: [node, pod, container]`. Disable `k8s.node.network.io`, `k8s.node.network.errors`, `k8s.pod.network.io` and `k8s.pod.network.errors`. Add env `K8S_NODE_NAME` from `spec.nodeName` through `extraEnvs`.
- `receivers.k8s_cluster`: `auth_type: serviceAccount`, `collection_interval: 60s`, `k8s_leader_elector: k8s_leader_elector`, `node_conditions_to_report: [Ready]`.
- `receivers.prometheus`: the chart default self-scrape job, plus `metric_relabel_configs: [{source_labels: [__name__], regex: "otelcol_process_.*", action: keep}]`.
- `processors.memory_limiter`: `check_interval: 1s`, `limit_mib: 200`, `spike_limit_mib: 40`.
- `processors.k8sattributes`: `auth_type: serviceAccount`, `passthrough: false`, `filter.node_from_env_var: K8S_NODE_NAME`, `extract.metadata` as asserted, `pod_association` from `connection`.
- `processors.batch`: chart default.
- `processors.transform/allowlist` with `error_mode: ignore`. The statements:

```yaml
trace_statements:
  - context: resource
    statements: ['keep_matching_keys(attributes, "^(service|k8s)\\.")']
  - context: span
    statements: ['keep_keys(attributes, ["http.request.method", "http.route", "http.response.status_code", "cashight.worker.outcome"])']
  - context: spanevent
    statements: ['keep_keys(attributes, [])']
metric_statements:
  - context: resource
    statements: ['keep_matching_keys(attributes, "^(service|k8s)\\.")']
  - context: datapoint
    statements:
      - 'keep_keys(attributes, ["http.request.method", "http.route", "http.response.status_code", "outcome", "error_code"]) where resource.attributes["service.namespace"] == "cashight"'
      - 'set(attributes["k8s.namespace.name"], resource.attributes["k8s.namespace.name"]) where IsMatch(metric.name, "^(k8s|container)\\.") and resource.attributes["k8s.namespace.name"] != nil'
      # same `set` for k8s.pod.name, k8s.container.name, k8s.node.name
log_statements:
  - context: resource
    statements: ['keep_matching_keys(attributes, "^(service|k8s)\\.")']
  - context: log
    statements: ['keep_keys(attributes, ["log.iostream"])']
```

- `exporters.otlphttp`: `endpoint` and `auth` as asserted.
- `service.pipelines`: `traces` ← `[otlp]`, `metrics` ← `[otlp, kubeletstats, k8s_cluster, prometheus]`, `logs` ← `[filelog]`. Logs come from `filelog` only, not OTLP, so Loki holds one copy. Processors and exporters as asserted.

- [ ] **Step 4: Emit `config-local.yaml` from `render-collector.sh`**

Apply `yq` edits to `config.yaml`:
- Delete `receivers.kubeletstats`, `receivers.k8s_cluster`, `processors.k8sattributes` and `extensions.k8s_leader_elector`, and remove them from `service.extensions` and every pipeline.
- Set `filelog.include = ["/var/log/local/*.log"]`, `exclude = []`, `operators = []`, and `start_at: beginning`.
- Add `exporters.file/local: {path: /var/log/local/collected.jsonl}` to every pipeline.
- Add `processors.transform/local` with log resource statement `set(attributes["k8s.namespace.name"], "cashight")` and `set(attributes["service.name"], "cashight-local")`, inserted before `batch` in `logs` only.

Assert in `check-collector.sh`: `Local config differs only as designed`. The local processor list is `[memory_limiter, transform/allowlist, batch]` for traces and metrics, and `[memory_limiter, transform/allowlist, transform/local, batch]` for logs.

- [ ] **Step 5: Run the check until it passes**

Run: `make collector-check && make yaml-check`
Expected: every line `PASS`, both `validate` runs exit 0, and both make targets exit 0. If `validate` rejects a component setting, fix it for the pinned collector version. Never drop an assertion to get a pass.

- [ ] **Step 6: Write `scripts/run-local-collector.sh` and prove its failure path**

The script takes `<log-dir>` and uses `PARAMETER_PREFIX`, defaulting to `$(terraform -chdir=environments/platform output -raw platform_parameter_prefix)`. It renders into a temp dir, fetches the three parameters exactly as the init container does (same loop, same `test -s`) into a `chmod 700` temp dir that a `trap` deletes on exit, and runs `docker run --rm -p 4318:4318 -e MY_POD_IP=0.0.0.0 -v <log-dir>:/var/log/local -v <secrets>:/secrets:ro <image> --config=/cfg/config-local.yaml`.

Run: `PARAMETER_PREFIX=/does-not-exist ./scripts/run-local-collector.sh "$(mktemp -d)"; echo "exit=$?"`
Expected: an AWS `ParameterNotFound` message naming `/does-not-exist/grafana-cloud/otlp-token`, then `exit=` non-zero, and no container started. The success path runs in Task 8, once the parameters exist. Then run `make shell-check`. Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add gitops/platform/config/addons/opentelemetry-collector.yaml scripts/
git commit -m "feat(gitops): configure the collector pipeline with an attribute allowlist"
```

---

## Task 4: Platform acceptance and docs

**Files:**
- Modify: `scripts/verify-platform.sh`
- Modify: `CLAUDE.md`, `AGENTS.md`, `README.md`, `docs/operations/validate-platform.md`, `docs/operations/deploy-platform.md`

**Interfaces:**
- Consumes: Task 1 output `otel_collector_role_arn`, Task 2 names.
- Produces: assertions Plan 4 runs once `enable_argocd = true`.

- [ ] **Step 1: Platform section (always checked)**

Add `assert_eq "Pod Identity association observability/otel-collector"`, comparing `aws eks list-pod-identity-associations --cluster-name "$cluster" --namespace observability --service-account otel-collector --query 'length(associations)'` with `1`.

- [ ] **Step 2: GitOps section**

- Add `observability` to `platform_namespaces` (line 128), so collector pods are not reported as stray workloads.
- Add `assert_eq "DaemonSet observability/otel-collector ready"`: `.status.numberReady` equals `.status.desiredNumberScheduled`, and both are ≥ 1.
- Add `assert_eq "No Secrets in observability"`: count of Secrets that are not of type `kubernetes.io/service-account-token` equals `0`.
- Add `assert_eq "observability is privileged"`: label `pod-security.kubernetes.io/enforce` equals `privileged`.

- [ ] **Step 3: Run the gates**

Run: `make shell-check`. Expected: exit 0. The cluster does not exist, so the live run is on Plan 4's acceptance list (see the handover section below).

- [ ] **Step 4: Docs**

- In `CLAUDE.md` and `AGENTS.md`, replace "Telemetry is not decided yet; the observability plan adds it." with one paragraph: a collector DaemonSet in `observability`, Grafana Cloud free tier, tokens from SSM via an init container under Pod Identity, no Kubernetes Secret, and a pointer to Cashight's `docs/observability.md`. Add `make collector-check` to the Commands block.
- In `README.md`, add the collector to the add-on list.
- In `validate-platform.md`, document the new assertions.
- In `deploy-platform.md`, add a pre-Stage-5 note: the three `grafana-cloud/*` SSM parameters must exist before Argo CD is turned on, or the collector pod stays in `Init:CrashLoopBackOff`.

- [ ] **Step 5: Commit and open the PR**

```bash
git add scripts/verify-platform.sh CLAUDE.md AGENTS.md README.md docs/operations
git commit -m "docs(platform): record the telemetry decision and collector acceptance"
git push -u origin feat/observability
gh pr create --base main --title "feat: OpenTelemetry Collector add-on for Grafana Cloud" --body "<summary, then the outputs of make terraform-check, make yaml-check, make collector-check, make shell-check>"
```

---

## Task 5: Telemetry drill and telemetry audit (`cashight`)

**Repo:** `cashight`. **Branch:** `feat/eks-observability` from `cashight-v2`.

**Files:**
- Create: `scripts/local/telemetry-audit.ts`, `scripts/__tests__/telemetry-audit.test.ts`
- Create: `scripts/local/telemetry-drill.ts`

**Interfaces:**
- Consumes: `startTelemetry(serviceName, env)` (`backend/server/telemetry.ts`), `createApiServer({ handlers, verifier, rateLimiter })` (`backend/server/http-server.ts`), `createSqsConsumer({ client, queueUrl, handler, maxProcessingMs, onFatal, waitTimeSeconds, sleep })` (`backend/server/sqs-consumer.ts`), `createRateLimiter({ capacity, refillPerSecond })`, `AccessTokenVerifier` and `AuthorizerClaims` (`backend/server/jwt.ts`), `logger` (`backend/shared/observability.ts`).
- Produces:
  - `ALLOWED_ATTRIBUTES: { resource: RegExp; span: readonly string[]; datapoint: readonly string[]; log: readonly string[] }`. These values mirror Task 3's `transform/allowlist`, and a comment names that file.
  - `findDisallowedAttributes(lines: string[]): string[]`. It takes JSON lines in the OTLP file-exporter format (`resourceSpans` / `resourceMetrics` / `resourceLogs`) and returns sorted unique `"<level>:<key>"` entries for keys outside the allowlist. Data-point keys are checked only when the resource has `service.namespace = cashight`.
  - `findSensitiveValues(lines: string[]): string[]`. It returns `"<level>:<pattern>"` for any attribute value or log body matching an email (`/[^\s"@]+@[^\s"@]+\.[^\s"@]+/`), a 13–19-digit run (`/\b\d{13,19}\b/`) or `Bearer ` (case-insensitive).
  - CLI: `pnpm tsx scripts/local/telemetry-audit.ts <collected.jsonl>`. It prints the findings and exits 1 if there are any.
  - CLI: `pnpm tsx scripts/local/telemetry-drill.ts --minutes <n> --rps <r> --error-ratio <0..1> --failed-jobs <k> --log-file <path>`. It starts the four Plan 1 service names (`cashight-api`, `cashight-aws-api`, `cashight-parser-worker`, `cashight-invoice-parser-worker`) against `OTEL_EXPORTER_OTLP_ENDPOINT` (default `http://localhost:4318`).

- [ ] **Step 1: Write the failing tests**

In `scripts/__tests__/telemetry-audit.test.ts`, build small OTLP-JSON fixtures inline:
- `accepts the attributes Cashight emits`: a span with the four span keys, a `cashight.worker.jobs` data point with `outcome`, a resource with `service.name`, `service.namespace=cashight`, `service.version` and `k8s.pod.name`. Expect `[]`.
- `reports a span attribute outside the allowlist`: span key `url.full`. Expect `["span:url.full"]`.
- `reports a resource attribute outside the allowlist`: `host.name`. Expect `["resource:host.name"]`.
- `ignores data-point attributes of infra metrics`: resource without `service.namespace`, data point with `state`. Expect `[]`.
- `reports a log attribute outside the allowlist`: `log.file.path`. Expect `["log:log.file.path"]`.
- `finds an email, a PAN-length digit run and a bearer token in values and bodies`: the log body `'{"message":"x","user":"a@b.co"}'` → `log:email`; span value `"4111111111111111"` → `span:digits`; log body containing `bearer abc` → `log:bearer`.
- `finds nothing sensitive in a trace id`: a body containing a 32-hex `trace_id`. Expect `[]`. Hex has letters, but guard against an all-digit run anyway: also test `"trace_id":"12345678901234567890123456789012"`, a 32-digit run, which the `\b\d{13,19}\b` boundaries must not match.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm test scripts/__tests__/telemetry-audit.test.ts`
Expected: FAIL, cannot resolve `../local/telemetry-audit`.

- [ ] **Step 3: Implement `scripts/local/telemetry-audit.ts`**

Walk the three OTLP shapes. Attribute lists are `{key, value: {stringValue|intValue|…}}` arrays, and metric data points sit under `sum`, `gauge` or `histogram` `.dataPoints`. Put the CLI under an `import.meta.url` main guard, as `scripts/dev-server.ts` does with its module-level code.

- [ ] **Step 4: Run the tests until they pass**

Run: `pnpm test scripts/__tests__/telemetry-audit.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Implement `scripts/local/telemetry-drill.ts`**

Header comment: never deployed, and this is why it exists (Departure 1). Behaviour:
- Pipe the `logger` output to `--log-file` (append) as well as stdout, by wrapping `process.stdout.write`. The local collector's `filelog` reads that file.
- For each API service name, call `startTelemetry(name)` in a child process (`node:child_process` `fork` of the same file with `--role <name>`), because the OTel global providers are per process. Start `createApiServer` on an ephemeral port with:
  - `verifier.verify` resolving `{ sub: 'drill', token_use: 'access', scope: 'drill' }`;
  - `rateLimiter: createRateLimiter({ capacity: 1000, refillPerSecond: 1000 })`;
  - `handlers: { dashboard: ok, statements: ok }` for `cashight-api` and `{ costExplorer: ok }` for `cashight-aws-api`, where `ok` logs `logger.info('drill request', { route, email: 'drill@example.com', description: 'GRAB*1234 4111111111111111' })` and returns `{ statusCode: 200, body: '{}' }`. Those sensitive fields must be stripped by `sanitizeForLog`, and Task 8's audit proves they are.
  - A failing handler that returns `{ statusCode: 500, body: '{}' }`, chosen with probability `--error-ratio`.
- The parent sends `--rps` requests per second with `Authorization: Bearer drill` for `--minutes`. Then it shuts down the children, which flush telemetry.
- For each worker name, a child runs `createSqsConsumer` with a fake `client.send` that returns `Messages` of `{ MessageId, Body: '{}', ReceiptHandle }` once per 10 s, and `{}` for `DeleteMessageCommand`. The handler logs `logger.info('drill job')` and returns `batchItemFailures` for the first `--failed-jobs` messages, and none after. Use `maxProcessingMs: 30_000`, `onFatal: process.exit`, `waitTimeSeconds: 0`.

- [ ] **Step 6: Smoke the drill without a collector**

Run: `OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:1 pnpm tsx scripts/local/telemetry-drill.ts --minutes 0.2 --rps 2 --error-ratio 0.5 --failed-jobs 1 --log-file "$(mktemp)"; echo "exit=$?"`
Expected: JSON log lines with `trace_id` on stdout, none containing `drill@example.com` or `4111`, and `exit=0`. Export failures to the unreachable port must not crash the process.

- [ ] **Step 7: Type check, lint, commit**

Run: `pnpm tsc --noEmit && pnpm lint`. Expected: exit 0.

```bash
git add scripts/local/telemetry-drill.ts scripts/local/telemetry-audit.ts scripts/__tests__/telemetry-audit.test.ts
git commit -m "feat(scripts): add a local telemetry drill and an attribute audit"
```

---

## Task 6: `terraform/grafana/` root: folder, Slack, notification policy, synthetic check, CI

**Files:**
- Create: `terraform/grafana/versions.tf`, `backend.tf`, `providers.tf`, `variables.tf`, `data.tf`, `notifications.tf`, `uptime.tf`, `terraform.tfvars.example`, `.terraform.lock.hcl`
- Create: `terraform/grafana/tests/notifications.tftest.hcl`, `terraform/grafana/tests/uptime.tftest.hcl`
- Modify: `.github/workflows/tf-ci.yaml`

**Interfaces:**
- Produces:
  - `grafana_folder.cashight_v2` (title `Cashight v2`), `grafana_contact_point.slack` (name `slack-cashight`) and `grafana_synthetic_monitoring_check.api_health` (job `cashight-v2-api-health`).
  - `local.check_job = "cashight-v2-api-health"`.
  - `data.grafana_data_source.prometheus`, `.loki` and `.tempo`, named `grafanacloud-${var.stack_slug}-prom`, `-logs` and `-traces`.
  - Variables: `grafana_url` (string), `grafana_auth` (string, sensitive), `sm_url` (string), `sm_access_token` (string, sensitive), `stack_slug` (string), `api_live` (bool, default `false`), `health_url` (string, default `https://api.cashight-v2.nghuy.link/health`), `slack_webhook_parameter` (string, default `/cashight/grafana/slack-webhook-url`).
  - Tasks 9 and 10 use the folder, the datasources, `local.check_job` and `var.api_live`.

- [ ] **Step 1: Write the failing tests**

Both test files declare `mock_provider "grafana"` and `mock_provider "aws"`.
- `mock_data "aws_ssm_parameter"` defaults `{ value = "https://hooks.slack.com/services/T0/B0/x" }`.
- `mock_data "grafana_synthetic_monitoring_probes"` defaults `{ probes = { Singapore = 1, Tokyo = 2, Paris = 3 } }`.
- `mock_data "grafana_data_source"` defaults `{ uid = "mock-uid" }`.
- `variables { grafana_url = "https://x.grafana.net", grafana_auth = "x", sm_url = "https://sm.example", sm_access_token = "x", stack_slug = "x" }`.

`notifications.tftest.hcl`, with `command = plan` in every run:
- `folder_is_cashight_v2`: `grafana_folder.cashight_v2.title == "Cashight v2"`.
- `slack_contact_point_reads_ssm`: `data.aws_ssm_parameter.slack_webhook.name == "/cashight/grafana/slack-webhook-url"`, `with_decryption == true`; the contact point has one `slack` block, and its `disable_resolve_message == false`.
- `policy_timings`: `grafana_notification_policy.main.group_by == ["alertname"]`, `group_wait == "30s"`, `group_interval == "5m"`, `repeat_interval == "4h"`, `contact_point == grafana_contact_point.slack.name`.

`uptime.tftest.hcl`:
- `check_disabled_until_api_live`: default variables give `enabled == false`, `target == "https://api.cashight-v2.nghuy.link/health"`, `frequency == 120000`, `timeout == 5000`, `probes == [1, 2]`, and one `settings[0].http[0]` with `valid_status_codes == [200]`.
- `check_enabled_when_api_live`: with `variables { api_live = true }`, `enabled == true`.

- [ ] **Step 2: Run them to see them fail**

Run: `cd terraform/grafana && terraform init -backend=false && terraform test`
Expected: init fails, or the tests fail with "Reference to undeclared resource". The root has no configuration yet.

- [ ] **Step 3: Write the root**

- `versions.tf`: `required_version = ">= 1.11, < 2.0"`, `grafana/grafana` pinned `~> N.0` to the newest major whose first release is at least 14 days old, and `hashicorp/aws ~> 6.0`.
- `backend.tf`: copy `terraform/backend.tf`, changing only `key = "cashight/grafana/terraform.tfstate"`.
- `providers.tf`: `grafana` with `url`, `auth`, `sm_url`, `sm_access_token`; `aws` with `region = "ap-southeast-1"`.
- `data.tf`: the three datasources; `grafana_synthetic_monitoring_probes "all"`; `aws_ssm_parameter "slack_webhook"` (`with_decryption = true`).
- `notifications.tf`: folder, contact point (`slack { url = data.aws_ssm_parameter.slack_webhook.value }`), notification policy.
- `uptime.tf`: `locals { check_job = "cashight-v2-api-health", probe_names = ["Singapore", "Tokyo"] }`. Write `probes = [for n in local.probe_names : data.grafana_synthetic_monitoring_probes.all.probes[n]]`. Indexing without a default makes plan fail loudly if a probe is renamed. `settings { http { method = "GET", valid_status_codes = [200], fail_if_not_ssl = true } }`. Add a comment on `api_live` (spec §5.3).
- `terraform.tfvars.example`: every variable with placeholder values and a header saying the real file is gitignored. Confirm `git check-ignore terraform/grafana/terraform.tfvars` prints the path. If it doesn't, add `terraform/grafana/terraform.tfvars` to `.gitignore`.

- [ ] **Step 4: Run the tests until they pass**

Run: `cd terraform/grafana && terraform init -backend=false && terraform validate && terraform test`
Expected: `Success! The configuration is valid.` and `5 passed, 0 failed`. Commit the generated `.terraform.lock.hcl`.

- [ ] **Step 5: CI**

In `tf-ci.yaml`, set `branches: [main, cashight-v2]`. Add a second job `grafana`, `working-directory: terraform/grafana`, with the same pinned Terraform and the steps `fmt -check -recursive -diff`, `init -backend=false`, `validate -no-color`, `test -no-color`, `tflint --init && tflint --no-color -f compact`. Root `fmt -check -recursive` already covers the new directory, so the existing job stays as it is.

- [ ] **Step 6: Commit**

```bash
git add terraform/grafana .github/workflows/tf-ci.yaml .gitignore
git commit -m "feat(grafana): add the Grafana Cloud Terraform root with Slack and the uptime check"
```

---

## Task 7: Runbook, Grafana Cloud bring-up, first apply

**Files:**
- Create: `docs/observability.md`

**Interfaces:**
- Produces: the SSM parameters from Global Constraints; a stack slug; `terraform/grafana/terraform.tfvars` (local only); applied folder, contact point, policy and disabled check.

- [ ] **Step 1: Write `docs/observability.md`**

Sections:
1. **What runs where:** one paragraph and the spec §4 table.
2. **One-time setup**, about 15 minutes. Steps:
   - Create the stack in a Singapore-region cluster and record the slug.
   - Create an access policy `cashight-otlp-write` with `metrics:write`, `logs:write` and `traces:write`, and a token on it.
   - From the stack's OpenTelemetry tile, copy the OTLP endpoint and the instance ID.
   - Create a service account `terraform-cashight` with the Admin role, and a token.
   - In the Synthetic Monitoring app, initialise it and generate an access token. Record the SM API URL.
   - Create a Slack incoming webhook for the alerts channel.
   - Write the SSM parameters. Every secret is read with `read -rs VALUE` and passed as `--value "$VALUE"`, so it never lands in shell history:

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

3. **Applying `terraform/grafana/`:** `eval "$(aws configure export-credentials --format env)"`, `terraform init -backend-config=../backend.hcl`, `plan`, `apply`. This is a workstation-only apply, with the reason given.
4. **Token rotation:** overwrite the SSM value with `--overwrite`, then `kubectl -n observability rollout restart ds/otel-collector`.
5. **Local verification run:** filled in by Task 8.
6. **Recorded metric names:** filled in by Task 8.
7. **Alerts:** one subsection per rule (what it means, first three things to check). Filled in by Task 9.
8. **Going live (Plan 4):** set `api_live = true` and apply.

- [ ] **Step 2: Do the setup**

Follow the runbook's section 2. Then verify:
Run: `aws ssm get-parameters --region ap-southeast-1 --names /aws-eks-infra/platform/grafana-cloud/otlp-token /aws-eks-infra/platform/grafana-cloud/otlp-endpoint /aws-eks-infra/platform/grafana-cloud/instance-id /cashight/grafana/slack-webhook-url --query 'length(Parameters)'`
Expected: `4`.

- [ ] **Step 3: First apply**

Write `terraform/grafana/terraform.tfvars` from the example. Run the runbook's section 3.
Expected: the plan creates the folder, the contact point, the notification policy and the check with `enabled = false`. The apply succeeds.

- [ ] **Step 4: Slack test**

In Grafana → Alerting → Contact points → `slack-cashight` → Test.
Expected: a test message in the Slack channel. Record the date in the runbook.

- [ ] **Step 5: Commit**

```bash
git add docs/observability.md
git commit -m "docs: add the observability runbook"
```

---

## Task 8: End-to-end local run and recorded metric names

**Files:**
- Create: `terraform/grafana/metrics.tf`
- Modify: `docs/observability.md` (sections 5 and 6)
- Possibly modify: backend instrumentation, only if the audit reports a privacy or series-budget violation (the spec §3.3 exception)

**Interfaces:**
- Consumes: `scripts/run-local-collector.sh` (Task 3, in the `aws-eks-infra` checkout), `scripts/local/telemetry-drill.ts` and `telemetry-audit.ts` (Task 5).
- Produces: `locals { metric = { … } label = { … } }` in `metrics.tf`. Tasks 9 and 10 reference only these. Keys:
  - `metric.http_count`, `metric.http_bucket` (from `http.server.request.duration`)
  - `metric.worker_jobs` (from `cashight.worker.jobs`)
  - `metric.worker_duration_bucket`
  - `metric.invoice_parse_failures`
  - `metric.collector_uptime`
  - `metric.container_restarts`, `metric.pod_cpu`, `metric.pod_memory`, `metric.node_memory`, `metric.container_memory_limit`
  - `label.status`, `label.route`, `label.outcome`, `label.error_code`, `label.namespace`, `label.pod`, `label.service`

- [ ] **Step 1: Start the collector**

Run, in `aws-eks-infra`: `LOG_DIR=$(mktemp -d) && echo "$LOG_DIR" && ./scripts/run-local-collector.sh "$LOG_DIR"`
Expected: the collector log shows `Everything is ready. Begin running and processing data.` and no `401` or `403` from `otlphttp`.

- [ ] **Step 2: Run the drill**

Run, in `cashight`: `pnpm tsx scripts/local/telemetry-drill.ts --minutes 3 --rps 1 --error-ratio 0.1 --failed-jobs 1 --log-file "$LOG_DIR/drill.log"`
Expected: exit 0, and `$LOG_DIR/collected.jsonl` grows during the run.

- [ ] **Step 3: Audit what arrived**

Run: `pnpm tsx scripts/local/telemetry-audit.ts "$LOG_DIR/collected.jsonl"; echo "exit=$?"`
Expected: no findings, `exit=0`.

If it reports a finding, apply the spec §3.3 exception. Find the source with `grep`. Fix it in the app if the app emitted it, or in the allowlist if the collector added it. Add a regression test beside the code you change, then rerun Steps 2–3.

- [ ] **Step 4: Confirm in Grafana**

Check each of these in Explore:
- (a) Prometheus has `http.server.request.duration` and `cashight.worker.jobs` series for the four service names.
- (b) Tempo has `GET dashboard` and `worker.job` spans.
- (c) Loki has a `drill request` line in `{k8s_namespace_name="cashight"}` whose `trace_id` opens the same trace in Tempo.
- (d) The Prometheus series labels contain nothing outside `label.*` plus `job`, `instance` and `service_*`.
- (e) Query `count({__name__=~".+"})`. The series count is in the low hundreds, far below 10k. Record the number.

- [ ] **Step 5: Record the names in `metrics.tf`**

Read the exact names from Explore's metric browser and label lists. The expected starting points are below. **Replace any that differ**: the Explore names are authoritative.

| Key | Expected |
|---|---|
| `http_count`, `http_bucket` | `http_server_request_duration_seconds_count`, `…_bucket` |
| `worker_jobs` | `cashight_worker_jobs_total` |
| `worker_duration_bucket` | `cashight_worker_job_duration_seconds_bucket` |
| `invoice_parse_failures` | `cashight_aws_invoice_parse_failure_total` |
| `collector_uptime` | `otelcol_process_uptime_seconds_total` or `otelcol_process_uptime_total` |
| `label.status`, `route`, `outcome`, `error_code`, `service` | `http_response_status_code`, `http_route`, `outcome`, `error_code`, `service_name` |

The Kubernetes keys (`container_restarts` = `k8s_container_restarts`, `pod_cpu` = `k8s_pod_cpu_usage`, `pod_memory` = `k8s_pod_memory_working_set_bytes`, `node_memory` = `k8s_node_memory_working_set_bytes`, `container_memory_limit` = `k8s_container_memory_limit_bytes`, `label.namespace` = `k8s_namespace_name`, `label.pod` = `k8s_pod_name`) cannot be observed without a cluster. Enter them as listed with a comment `# unverified until Plan 4 (handover item 1)`.

- [ ] **Step 6: Runbook and commit**

Write runbook sections 5 (Steps 1–4 as commands) and 6 (the table, the series count from Step 4e, and the date).

```bash
git add terraform/grafana/metrics.tf docs/observability.md
git commit -m "docs(observability): record OTLP-to-Prometheus names from the local run"
```

---

## Task 9: Alert rules

**Files:**
- Create: `terraform/grafana/alerts.tf`, `terraform/grafana/tests/alerts.tftest.hcl`
- Modify: `docs/observability.md` (section 7)

**Interfaces:**
- Consumes: `local.metric`, `local.label` (Task 8), `local.check_job`, `var.api_live`, `grafana_folder.cashight_v2`, `data.grafana_data_source.prometheus` (Task 6).
- Produces: `grafana_rule_group.cashight_v2`, with rules named exactly `API down`, `Telemetry stopped`, `API errors`, `Parse jobs failing` and `Pod crash-looping`.

- [ ] **Step 1: Write the failing tests**

`alerts.tftest.hcl` uses the same mock providers and variables as Task 6. Define a helper for the assertions: `rule = { for r in grafana_rule_group.cashight_v2.rule : r.name => r }`. In a test it is written inline, as `[for r in … : r if r.name == "API down"][0]`.
- `five_rules_in_folder`: `length(rule) == 5`, `folder_uid == grafana_folder.cashight_v2.uid`, `interval_seconds == 60`.
- `severity_and_pending`: `API down` and `Telemetry stopped` have `labels.severity == "critical"` and `for == "0s"`. The other three have `"warning"` and `"5m"`.
- `no_data_states`: `API down` and `Telemetry stopped` are `"Alerting"`. The other three are `"OK"`.
- `paused_until_api_live`: by default, `API down` and `Telemetry stopped` have `is_paused == true` and the other three `false`. A second run with `api_live = true` gives all five `false`.
- `api_errors_needs_volume`: the `API errors` query model's `expr` contains `">= 20"` and `"0.05"`.
- `queries_use_recorded_names`: each rule's `expr` contains its `local.metric` value, and `API down` contains `local.check_job`.

- [ ] **Step 2: Run them to see them fail**

Run: `cd terraform/grafana && terraform test -filter=tests/alerts.tftest.hcl`
Expected: FAIL, undeclared `grafana_rule_group.cashight_v2`.

- [ ] **Step 3: Write `alerts.tf`**

Use a `locals { rules = { … } }` map and one `grafana_rule_group` with `dynamic "rule"`, so each rule is data, not a repeated block. Each rule has two data entries: `A`, a Prometheus instant query over a 600 s relative range, and `C`, a `__expr__` threshold on `A` with `condition = "C"`. Use `exec_err_state = "Error"` and an `annotations.summary` line. The PromQL, with `M` = `local.metric` and `L` = `local.label`:

| Rule | `expr` | Threshold |
|---|---|---|
| API down | `sum(max_over_time(probe_success{job="${local.check_job}"}[6m]))` | `< 1` |
| Telemetry stopped | `count(max_over_time(${M.collector_uptime}[10m]))` | `< 1`. With no series at all the query returns no data, which `no_data_state = "Alerting"` turns into firing. |
| API errors | `(sum(increase(${M.http_count}{${L.status}=~"5.."}[10m])) / sum(increase(${M.http_count}[10m])) > 0.05) and on() (sum(increase(${M.http_count}[10m])) >= 20)` | `> 0` |
| Parse jobs failing | `sum(increase(${M.worker_jobs}{${L.outcome}!="succeeded"}[15m]))` | `> 0` |
| Pod crash-looping | `max by (${L.namespace}, ${L.pod}) (increase(${M.container_restarts}{${L.namespace}=~"cashight\|observability\|keda"}[15m]))` | `>= 3`, written `gt 2.5`, since restarts are integers |

Set `is_paused = !var.api_live` on rules 1 and 2, and `false` on the rest.

- [ ] **Step 4: Run the tests until they pass**

Run: `terraform test`
Expected: all files pass (Task 6's 5 plus 7 alert runs, counting the `api_live = true` run).

- [ ] **Step 5: Apply and check each query in Explore**

Run the runbook's apply. Expected: one rule group created. Then rerun the Task 8 drill (`--minutes 3`). Paste each rule's `expr` into Explore and confirm:
- `Parse jobs failing` returns 1 or more.
- `API errors` returns a value when the drill uses `--error-ratio 0.3 --rps 1` for 3 minutes, and nothing at `--error-ratio 0`.
- `Telemetry stopped`'s query returns `1` while the local collector runs.
- `API down` returns no data, because the check is disabled.
- `Pod crash-looping` returns no data (no cluster).

In Alerting, rules 1 and 2 show Paused and rules 3–5 show Normal.

- [ ] **Step 6: Runbook and commit**

Write runbook section 7: per rule, what it means and the first three checks. For example, for `API down`: the node exists (`kubectl get nodes`), Spot interruption events, then the ALB target health.

```bash
git add terraform/grafana/alerts.tf terraform/grafana/tests/alerts.tftest.hcl docs/observability.md
git commit -m "feat(grafana): add the five Cashight v2 alert rules"
```

---

## Task 10: Dashboard

**Files:**
- Create: `terraform/grafana/dashboards/cashight-v2.json`, `terraform/grafana/dashboard.tf`, `terraform/grafana/tests/dashboard.tftest.hcl`

**Interfaces:**
- Consumes: `local.metric`, `local.label`, the three datasources, `grafana_folder.cashight_v2`.
- Produces: `grafana_dashboard.cashight_v2`, uid `cashight-v2`.

- [ ] **Step 1: Write the failing test**

`dashboard.tftest.hcl` (mocks as in Task 6):
- `dashboard_in_folder`: `grafana_dashboard.cashight_v2.folder == grafana_folder.cashight_v2.uid`, and `jsondecode(grafana_dashboard.cashight_v2.config_json).title == "Cashight v2"`.
- `dashboard_uses_recorded_names`: `config_json` contains each of `local.metric.http_count`, `http_bucket`, `worker_jobs`, `worker_duration_bucket`, `invoice_parse_failures`, `container_restarts`, `pod_memory` and `node_memory`.
- `dashboard_has_no_hardcoded_datasource_uid`: `config_json` contains no `"mock-uid"` (the dashboard takes datasource uids from the template variables below).

- [ ] **Step 2: Run it to see it fail**

Run: `terraform test -filter=tests/dashboard.tftest.hcl`
Expected: FAIL, undeclared `grafana_dashboard.cashight_v2`.

- [ ] **Step 3: Build the dashboard**

Build it in the Grafana UI on the stack, then export the JSON model with "Export for sharing externally" off. Strip `id` and `version`, and set `uid = "cashight-v2"` and `title = "Cashight v2"`. Datasources are dashboard variables `prom`, `logs` and `traces` (type `datasource`, query `prometheus` / `loki` / `tempo`), and panels reference `${prom}` etc. Grafana dashboard syntax uses `${…}` too, so the file is loaded with `file()`, not `templatefile()`, and metric names are written literally. The test pins them to `metrics.tf`. Rows and panels:
1. **API**: one row per service (`cashight-api`, `cashight-aws-api`) with request rate by `http_route`, 5xx ratio by `http_route`, and p95 latency (`histogram_quantile(0.95, sum by (le, http_route) (rate(<http_bucket>[$__rate_interval])))`).
2. **Workers**: jobs by `outcome` (rate), duration p50 and p95, invoice parse failures by `error_code`.
3. **Capacity**: node memory with the node's allocatable as a constant line labelled "4 GiB node", pod CPU and pod memory against `container_memory_limit` for `cashight`.
4. **Restarts**: container restarts over `$__range` by namespace and pod.
5. **Logs**: a table over `{k8s_namespace_name="cashight"} | json` showing time, `service_name`, `level`, `message` and `trace_id`. The `trace_id` field has a data link to Explore on `${traces}` with the query `${__value.raw}`.

`dashboard.tf`: `config_json = file("${path.module}/dashboards/cashight-v2.json")`, `folder = grafana_folder.cashight_v2.uid`, `overwrite = true`.

- [ ] **Step 4: Run the tests until they pass, then apply**

Run: `terraform test`, then the runbook apply.
Expected: all tests pass, and the apply creates one dashboard. Rerun the drill and open the dashboard. The API, Workers and Logs rows show data, and clicking a `trace_id` opens the trace. Capacity and Restarts are empty (no cluster).

- [ ] **Step 5: Commit**

```bash
git add terraform/grafana/dashboard.tf terraform/grafana/dashboards terraform/grafana/tests/dashboard.tftest.hcl
git commit -m "feat(grafana): add the Cashight v2 dashboard"
```

---

## Task 11: Fire and resolve rules 3 and 4, doc edits, PR

**Files:**
- Modify: `docs/observability.md` (drill record), `docs/container-runtime.md:36` (endpoint), `docs/superpowers/specs/2026-10-08-eks-migration-design.md` (§4.5, §4.6, open point 2)

- [ ] **Step 1: Fire `API errors` and `Parse jobs failing`**

With the local collector running (Task 8 Step 1), run: `pnpm tsx scripts/local/telemetry-drill.ts --minutes 12 --rps 1 --error-ratio 0.2 --failed-jobs 3 --log-file "$LOG_DIR/drill.log"`
Expected: within about 12 minutes, Slack receives one `[FIRING] API errors` and one `[FIRING] Parse jobs failing` message, grouped by alertname.

- [ ] **Step 2: Resolve them**

Run the drill with `--minutes 20 --error-ratio 0 --failed-jobs 0`.
Expected: Slack receives `[RESOLVED]` for both. `API errors` resolves once the 10-minute window holds no 5xx, and `Parse jobs failing` once the 15-minute window holds no failed job.

- [ ] **Step 3: Low-volume guard (Review Focus 4)**

Run the drill with `--minutes 10 --rps 0.03 --error-ratio 0.5 --failed-jobs 0`, about 18 requests in 10 min.
Expected: `API errors` stays Normal, and no Slack message arrives.

- [ ] **Step 4: Doc edits**

- In `docs/observability.md`, record the Step 1–3 results with timestamps.
- In `docs/container-runtime.md`, change the example endpoint `http://otel-gateway.observability:4318` to `http://otel-collector.observability:4318` (spec §3.3). Leave the `otlpSignalUrl` test fixtures alone; they are arbitrary URLs.
- In the migration design, make §4.6 and the AnalysisTemplate text in §4.5 one line each pointing to the observability spec (§4.5: the canary gate is the smoke-test Job built in Plan 4). Mark open point 2 as decided: Slack.

- [ ] **Step 5: Final checks**

Run: `pnpm test && pnpm tsc --noEmit && pnpm lint && (cd terraform/grafana && terraform fmt -check -recursive && terraform validate && terraform test)`
Expected: all exit 0.

- [ ] **Step 6: Commit and PR**

```bash
git add docs
git commit -m "docs: close the observability plan and point the migration design at it"
git push -u origin feat/eks-observability
gh pr create --base cashight-v2 --title "feat: Grafana Cloud observability for Cashight v2 (Plan 3)" --body "<summary, Departures list, the drill record, validation outputs>"
```

---

## Handover to Plan 4 (copy into its acceptance list)

1. Confirm the Kubernetes metric and label names in `terraform/grafana/metrics.tf` marked `unverified until Plan 4`, then fix any that differ and re-apply.
2. With `enable_argocd = true`: the collector Application is Synced and Healthy, and `scripts/verify-platform.sh` passes the Task 4 assertions.
3. kubeletstats, k8s_cluster and pod logs (including add-on namespaces) arrive. Logs from the collector itself do not.
4. Rule 5 fires for real: a crash-looping test pod in `cashight` restarts 3 or more times in 15 minutes.
5. Set `api_live = true` and apply once `https://api.cashight-v2.nghuy.link/health` serves. The check becomes active and rules 1 and 2 are unpaused. Stop the node or scale the API to zero to see rule 1 fire and resolve.
6. Add `cashight` namespace NetworkPolicies allowing egress to namespace `observability` on TCP 4318, and set `OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector.observability:4318` on every Cashight workload.
7. The Argo Rollouts canary gate is the smoke-test Job. There is no AnalysisTemplate.
