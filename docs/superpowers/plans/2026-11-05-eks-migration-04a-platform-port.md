# EKS Migration, Plan 4a: Port the Platform into Cashight — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move everything Cashight needs from `aws-eks-infra` into this repo: the EKS platform Terraform, the Argo CD add-ons, the platform scripts and the runbook. Then decouple them, recreate the few live resources from `cashight`, destroy the `aws-eks-infra` copies, and revert `aws-eks-infra` to its generic reference state. No cluster is created.

**Architecture:** There are two new Terraform roots, split by lifecycle, both state-backed in `cashight-tfstate`:
- `terraform/platform-base/` is persistent: the account budget, the Identity Center group, and the CodeConnections connection.
- `terraform/platform/` is ephemeral. It holds the VPC, EKS, 2 × `t4g.large` on-demand nodes, managed Argo CD and the GitOps bootstrap. It reads `platform-base` through `terraform_remote_state`.

Argo CD reconciles `deploy/platform/` from `HuyNguyen260398/cashight@cashight-v2`. Nothing crosses repositories any more: no SSM identifier contract, and no `/platform/aws-eks-infra/...` names.

**Tech Stack:** Terraform 1.15.2 (AWS provider 6.x, `kubernetes` provider 3.x, `terraform-aws-modules/eks` 21.x, `terraform-aws-modules/vpc` 6.x), `terraform test` with mock providers, TFLint + `tflint-ruleset-aws` 0.42.0, Checkov, Amazon EKS 1.35, EKS managed Argo CD capability, AWS CodeConnections, Helm 3.18, Kustomize (kubectl 1.35), kubeconform, yamllint 1.37.1, shellcheck, `otelcol-contrib validate` (Docker), GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-05-eks-plan-4-open-points.md`: answers 1a–1e, 2, 6, 7, F1, F5, F6, and the "Proposed resolution for 1d" table. The background is `docs/superpowers/specs/2026-10-08-eks-migration-design.md` §4.1 and §4.5, plus Plans 2 and 3 for the code being ported.

## Where this plan sits

| Plan | Scope | State |
|---|---|---|
| 1 | Container runtime | done (#135) |
| 2 | Prerequisites, platform capacity (in `aws-eks-infra`) | done (`aws-eks-infra` #17), **superseded by this plan** |
| 3 | Observability (collector in `aws-eks-infra`, Grafana root in `cashight`) | done (`aws-eks-infra` #18, `cashight` #139); collector half **moved by this plan** |
| **4a** | **Platform port, decoupling, `aws-eks-infra` revert** | this plan |
| 4b | Persistent v2 AWS resources (own data stores, ECR, DNS/ACM, v2 SPA, AUTHZ seed) + deferred Plan 1 hardening | next |
| 4c | Ephemeral bring-up / teardown, `deploy/cashight/`, image pipeline, Plan 3 handover | after 4b |
| 5 | Cutover | parked (F1) |

## Source material

The code being ported lives in `../aws-eks-infra` at commit `f24ac9b` (`main`). Port by copying the named file and applying the listed edits. **Do not rewrite logic that is not listed.** The source was reviewed and validated in Plans 2 and 3. Comments that name `aws-eks-infra`, Jenkins, "workload repositories" or SSM-published identifiers are reworded so they describe this repo.

## Branching

| Tasks | Repo | Branch | PR into |
|---|---|---|---|
| 1–8 | `cashight` | `feat/platform-port`, cut from `cashight-v2` | `cashight-v2` (never `main`) |
| 9 | AWS account (workstation) | n/a | n/a |
| 10 | `aws-eks-infra` | `revert/generic-reference`, cut from `main` | `main` |

Task 9 runs only after the Tasks 1–8 PR is merged. Task 10 runs only after Task 9's destroy has succeeded. Reverting first would leave `aws-eks-infra` state that its code no longer describes.

## Global Constraints

- Region `ap-southeast-1` everywhere. Account-level only, no other region.
- State: bucket `cashight-tfstate`, KMS `alias/cashight-tfstate`, `use_lockfile = true`. Keys `cashight/platform-base/terraform.tfstate` and `cashight/platform/terraform.tfstate`. The existing roots `terraform/` and `terraform/grafana/` are **not modified** (v1 must not change).
- Both new roots are applied **from the workstation only**, like `terraform/grafana/`. CI runs `fmt -check`, `validate -backend=false`, `test` and `tflint` (plus Checkov) and never `plan` or `apply`. `infrastructure-deploy.yaml` is not touched.
- `resource_prefix = "cashight"`, `environment = "v2"`, so the cluster is named **`cashight-v2`** and IAM roles are `cashight-v2-*`. Every IAM role name stays ≤ 38 characters where a `name_prefix` applies (the node role is `cashight-v2-node`).
- Nodes: **`instance_types = ["t4g.large"]`, `capacity_type = "ON_DEMAND"`, `node_count = 2`** (min = max = desired). Public subnets, no NAT gateway, no Fargate, IMDSv2 hop limit 1, `maxPods: 110`, 20 GB gp3 encrypted root, as in the source.
- EKS 1.35, `authentication_mode = "API"`, public endpoint limited to `public_access_cidrs` (`/32`s, `0.0.0.0/0` rejected).
- `enable_argocd` stays a variable, **default `true`**. A test cluster without Argo CD is useless, and the capability only bills while the cluster exists.
- GitOps source: repository `HuyNguyen260398/cashight` via the CodeConnections Git-HTTP URL, revision **`cashight-v2`**, platform path **`deploy/platform/`**. Workload Application manifests live in **`deploy/workloads/`** (empty in this plan; 4c adds Cashight's Application).
- Grafana Cloud SSM parameters move to **`/cashight/grafana-cloud/{otlp-token,otlp-endpoint,instance-id}`** (token SecureString, others String, created by hand). `/cashight/grafana/slack-webhook-url` is unchanged.
- **Nothing in `cashight` may reference `aws-eks-infra`** after this plan, except the history notes in `docs/superpowers/` and `docs/aws-cost-review-2026-07.md`. Task 8 adds a grep check.
- Pinned versions carried over unchanged: Argo Rollouts chart 2.40.5, KEDA 2.21.0, cert-manager v1.21.0, AWS Load Balancer Controller chart 1.14.0, opentelemetry-collector chart 0.175.0 (and its image tag as in the source).
- Cost: this plan creates only the budget, an Identity Center group and a CodeConnections connection (≈ $0). **No `terraform apply` of `terraform/platform/`.**

## Review Focus

1. **The old and new budgets overlap, or there is a gap.** Expected: the new `cashight-account-monthly` budget exists and has its notifications before `aws-eks-infra-account-monthly` is destroyed. Owner: Task 9, Steps 5 and 6 (the destroy runs only after a describe-budget check).
2. **Argo CD reads the repository at the wrong path or revision.** If `deploy/platform/bootstrap` paths in the ApplicationSets still say `gitops/...`, every Application sits in `ComparisonError` on first bring-up, and nothing in 4a catches it. Expected: no file under `deploy/` contains the string `gitops/`. Owner: Task 4, Step 1 (`scripts/platform/check-deploy-paths.sh`).
3. **The collector reads the old SSM prefix.** Expected: the rendered init container's parameter path is `/cashight/grafana-cloud`, the collector IAM policy allows `parameter/cashight/grafana-cloud/*`, and a run against the old prefix exits non-zero. Owner: Task 3 (terraform test), Task 4 (`check-collector.sh` assertion), Task 7, Step 4.
4. **`terraform plan` of `terraform/platform/` fails on a fresh account** because the `kubernetes_manifest` bootstrap needs a live API server during plan. Expected: the first plan or apply targets `module.platform_cluster`, and the runbook says so. Owner: Task 3, Step 7 (targeted plan against real state), Task 6 (runbook).
5. **Teardown hangs on the VPC.** A controller-made ALB or a workload Application left in place blocks the destroy. Expected: `destroy-platform.sh` refuses while any Application sources `deploy/workloads`, or while any Ingress or LoadBalancer Service exists. Owner: Task 5, Step 1 (the script's guard on `deploy/workloads`).

---

## File map

| File | Task | Responsibility |
|---|---|---|
| `terraform/platform-base/{versions,backend,providers,variables,main,budget,outputs}.tf`, `terraform.tfvars.example`, `.terraform.lock.hcl` | 1 | Persistent account-level resources |
| `terraform/platform-base/tests/platform_base.tftest.hcl` | 1 | Mocked plan assertions |
| `terraform/modules/platform_cluster/*` (from `modules/platform_cluster`) | 2 | VPC, EKS, node group, add-ons, IAM (LB controller IRSA, KEDA, collector), Argo CD capability, log KMS |
| `terraform/modules/platform_bootstrap/*` (from `modules/platform_cluster_bootstrap`) | 2 | Argo CD cluster Secret + bootstrap ApplicationSet |
| `terraform/platform/{versions,backend,providers,variables,main,outputs}.tf`, `terraform.tfvars.example`, `.terraform.lock.hcl` | 3 | Ephemeral cluster root, reads `platform-base` |
| `terraform/platform/tests/platform.tftest.hcl` | 3 | Mocked plan assertions |
| `deploy/platform/{bootstrap,charts/namespace-config,config/addons,config/namespaces,config/observability}/**` (from `gitops/platform/**`) | 4 | Argo CD add-ons and the `cashight` namespace |
| `deploy/workloads/.gitkeep` | 4 | Target of the workloads ApplicationSet |
| `.yamllint.yml` | 4 | yamllint config for `deploy/` |
| `scripts/platform/{render-collector,check-collector,run-local-collector,check-deploy-paths}.sh` | 4 | Collector render/assert, local collector, path guard |
| `scripts/platform/{verify-prerequisites,verify-platform,destroy-platform,platform-info,check-repo-access}.sh` | 5 | Operational scripts |
| `.github/workflows/platform-ci.yaml` | 6 | CI for the new roots, `deploy/platform`, `scripts/platform` |
| `docs/platform.md` | 6 | Runbook: state, bring-up, access, validate, teardown |
| `docs/observability.md`, `scripts/local/telemetry-{drill,audit}.ts`, `backend/server/http-server.ts` | 7 | SSM rename, drop `aws-eks-infra` references |
| `docs/superpowers/specs/2026-10-08-eks-migration-design.md`, `docs/superpowers/specs/2026-11-05-eks-plan-4-open-points.md`, `CLAUDE.md` | 8 | Record the new ownership and lifecycle |

Not ported (YAGNI): `bootstrap/terraform-state` (`cashight-tfstate` already exists), `modules/ack_iam_role_selector` (unused since #17), `environments/platform/published.tf` (1c), `scripts/check-drift.sh` (ephemeral root), `.github/workflows/*` (replaced by Task 6), `docs/architecture/*` diagrams.

---

## Task 1: `terraform/platform-base/` root

**Files:**
- Create: `terraform/platform-base/versions.tf`, `backend.tf`, `providers.tf`, `variables.tf`, `main.tf`, `budget.tf`, `outputs.tf`, `terraform.tfvars.example`
- Create: `terraform/platform-base/tests/platform_base.tftest.hcl`
- Source: `../aws-eks-infra/environments/platform/{main,budget,variables,versions,providers}.tf`

**Interfaces:**
- Produces outputs, which Task 3 reads via `terraform_remote_state` and Task 5 reads via `terraform output`:
  - `identity_store_id` (string)
  - `identity_center_instance_arn` (string)
  - `argocd_admin_group_id` (string)
  - `github_connection_arn` (string)
  - `codeconnections_git_http_base` (string, `https://codeconnections.<region>.amazonaws.com/git-http/<account>/<region>/<connection-id>`)
  - `budget_name` (string)

- [ ] **Step 1: Write the failing test** `terraform/platform-base/tests/platform_base.tftest.hcl`

Use `mock_provider "aws" {}`. Add `override_data` for `data.aws_ssoadmin_instances.current` (`identity_store_ids = ["d-1234567890"]`, `arns = ["arn:aws:sso:::instance/ssoins-1"]`) and for `data.aws_caller_identity.current` (`account_id = "111122223333"`). Variables: `budget_notification_emails = ["ops@example.com"]`, `argocd_admin_user_ids = ["u-1"]`. Runs, all `command = plan`:

```hcl
run "budget_is_account_wide_with_four_alerts" {
  command = plan
  assert {
    condition     = aws_budgets_budget.account_monthly.name == "cashight-account-monthly"
    error_message = "budget name"
  }
  assert {
    condition     = aws_budgets_budget.account_monthly.limit_amount == "50"
    error_message = "default monthly_budget_usd is 50"
  }
  assert {
    condition     = length(aws_budgets_budget.account_monthly.notification) == 4
    error_message = "actual 50/80/100 and forecast 100"
  }
}

run "connection_and_group_names" {
  command = plan
  assert {
    condition     = aws_codeconnections_connection.github.name == "cashight-github" && aws_codeconnections_connection.github.provider_type == "GitHub"
    error_message = "connection"
  }
  assert {
    condition     = aws_identitystore_group.argocd_admins.display_name == "cashight-argocd-admins"
    error_message = "group"
  }
}

run "rejects_empty_budget_emails" {
  command         = plan
  variables { budget_notification_emails = [] }
  expect_failures = [var.budget_notification_emails]
}
```

- [ ] **Step 2: Run it and check that it fails**

Run: `terraform -chdir=terraform/platform-base init -backend=false && terraform -chdir=terraform/platform-base test`
Expected: FAIL, with no configuration files or undeclared resources.

- [ ] **Step 3: Implement the root**

- `versions.tf`: `required_version = ">= 1.11.0"`, `hashicorp/aws ~> 6.0`.
- `backend.tf`: the same block as `terraform/grafana/backend.tf`, with key `cashight/platform-base/terraform.tfstate` and a header comment saying it is applied from the workstation only.
- `providers.tf`: the `aws` provider with `region = var.aws_region` and `default_tags { tags = local.tags }`. No `profile` argument: the repo's auth bridge (`aws configure export-credentials`) supplies env credentials, which is how the other roots run.
- `variables.tf`, with validations:
  - `aws_region` (default `"ap-southeast-1"`)
  - `resource_prefix` (default `"cashight"`)
  - `argocd_admin_user_ids` (set(string), at least one)
  - `budget_notification_emails` (list(string), at least one, each matching `^[^@\\s]+@[^@\\s]+$`)
  - `monthly_budget_usd` (number, default `50`, > 0)
- `main.tf`: from the source `main.tf`, keep only `aws_caller_identity`, `aws_ssoadmin_instances`, the `identity_store_id`, `identity_center_instance_arn`, `connection_id` and `codeconnections_git_http_base` locals, the `single_identity_center_instance` check, `aws_identitystore_group.argocd_admins` with its memberships, and `aws_codeconnections_connection.github`. Tags are `{ Environment = "platform-base", ManagedBy = "Terraform", Project = var.resource_prefix }`.
- `budget.tf`: copy the source unchanged. The comment's "before the cluster" reference now points at `docs/platform.md`.
- `outputs.tf`: the six outputs in Interfaces.
- `terraform.tfvars.example`: the three required variables with placeholders, and a comment that a test day costs a few dollars, so $50 leaves headroom.
- Add `terraform/platform-base/terraform.tfvars` to `.gitignore` (and `terraform/platform/terraform.tfvars` for Task 3).

- [ ] **Step 4: Run the tests and check that they pass**

Run: `terraform -chdir=terraform/platform-base fmt -check && terraform -chdir=terraform/platform-base validate && terraform -chdir=terraform/platform-base test`
Expected: `Success! 3 passed, 0 failed.`

- [ ] **Step 5: Commit** (including `.terraform.lock.hcl` from `init`)

```bash
git add terraform/platform-base .gitignore
git commit -m "feat(platform): add the persistent platform-base Terraform root"
```

## Task 2: Port the cluster and bootstrap modules

**Files:**
- Create: `terraform/modules/platform_cluster/` with every file from `../aws-eks-infra/modules/platform_cluster/` (incl. `policies/aws-load-balancer-controller.json`)
- Create: `terraform/modules/platform_bootstrap/` with every file from `../aws-eks-infra/modules/platform_cluster_bootstrap/`

**Interfaces:**
- Produces module `platform_cluster`. Its inputs are unchanged from the source except:
  - `node_capacity_type` defaults to `"ON_DEMAND"`
  - `node_instance_types` defaults to `["t4g.large"]`
  - `node_count` defaults to `2`

  Its outputs are unchanged from the source. Task 3 uses `cluster_name`, `cluster_arn`, `cluster_endpoint`, `cluster_certificate_authority_data`, `vpc_id`, `aws_load_balancer_controller_role_arn`, `keda_operator_role_arn` and `otel_collector_role_arn`.
- Produces module `platform_bootstrap`. Its inputs are the source's, except that **`platform_parameter_prefix` is renamed `grafana_cloud_parameter_path`**, and the cluster-Secret annotation is renamed with it (`grafana_cloud_parameter_path = var.grafana_cloud_parameter_path`). Task 4's collector ApplicationSet reads `{{ .metadata.annotations.grafana_cloud_parameter_path }}`.

- [ ] **Step 1: Copy the two module directories** with `cp -R`, then make these edits only:
  1. Change the three node defaults in `platform_cluster/variables.tf` (above).
  2. Rewrite the node-group comment in `eks.tf`: "Two on-demand Graviton nodes run the platform controllers and Cashight for a test day; the cluster is torn down afterwards (docs/platform.md)". Keep the same-size check in `locals.tf`.
  3. In `platform_bootstrap`, rename the variable and the annotation (Interfaces).
  4. In `iam_pod_identity.tf`, change the collector comment from "Cashight docs/observability.md" to "docs/observability.md". Leave the code alone.

- [ ] **Step 2: Check that nothing outside the listed edits changed**

Run: `diff -r ../aws-eks-infra/modules/platform_cluster terraform/modules/platform_cluster; diff -r ../aws-eks-infra/modules/platform_cluster_bootstrap terraform/modules/platform_bootstrap`
Expected: only the edits from Step 1.

- [ ] **Step 3: Format check**

Run: `terraform fmt -check -recursive terraform/modules/platform_cluster terraform/modules/platform_bootstrap`
Expected: exit 0. The modules are validated through the Task 3 root.

- [ ] **Step 4: Commit**

```bash
git add terraform/modules/platform_cluster terraform/modules/platform_bootstrap
git commit -m "feat(platform): port the EKS cluster and Argo CD bootstrap modules"
```

## Task 3: `terraform/platform/` ephemeral root

**Files:**
- Create: `terraform/platform/versions.tf`, `backend.tf`, `providers.tf`, `variables.tf`, `main.tf`, `outputs.tf`, `terraform.tfvars.example`
- Create: `terraform/platform/tests/platform.tftest.hcl`
- Source: `../aws-eks-infra/environments/platform/{main,variables,outputs,providers,versions}.tf`

**Interfaces:**
- Consumes: the `platform-base` outputs (Task 1) via `data "terraform_remote_state" "platform_base"` (s3 backend, the same bucket/region/KMS, key `cashight/platform-base/terraform.tfstate`). Also the module interfaces from Task 2.
- Produces outputs, read by Task 5's scripts and by 4c:
  - the source's outputs, minus `argocd_admin_group_id`, `github_connection_arn` and `platform_parameter_prefix` (these now come from `platform-base`)
  - `grafana_cloud_parameter_path`
  - `gitops_repo_url`
  - `argocd_enabled`

- [ ] **Step 1: Write the failing test** `terraform/platform/tests/platform.tftest.hcl`

Mock providers: `aws`, `kubernetes`, and every other provider that `.terraform.lock.hcl` lists after `init` (the EKS module pulls in `tls`, `time` and `cloudinit`). Add these overrides:
- `override_data` for `data.terraform_remote_state.platform_base`, with outputs `{ identity_store_id = "d-1", identity_center_instance_arn = "arn:aws:sso:::instance/ssoins-1", argocd_admin_group_id = "g-1", github_connection_arn = "arn:aws:codeconnections:ap-southeast-1:111122223333:connection/abc", codeconnections_git_http_base = "https://codeconnections.ap-southeast-1.amazonaws.com/git-http/111122223333/ap-southeast-1/abc" }`
- `data.aws_availability_zones.available` inside `module.platform_cluster`: names `ap-southeast-1a/b/c`
- `data.aws_ec2_instance_type.node`: `default_vcpus = 2`, `memory_size = 8192`

Use `public_access_cidrs = ["203.0.113.10/32"]`. Every run is `command = plan`.

```hcl
run "two_on_demand_t4g_large_nodes" {
  command = plan
  assert {
    condition = (
      module.platform_cluster.node_group_name == "cashight-v2-general" &&
      var.node_count == 2 && var.node_capacity_type == "ON_DEMAND" &&
      var.node_instance_types == ["t4g.large"]
    )
    error_message = "2 x t4g.large ON_DEMAND in node group cashight-v2-general"
  }
}

run "gitops_points_at_cashight_v2" {
  command = plan
  assert {
    condition     = output.gitops_repo_url == "https://codeconnections.ap-southeast-1.amazonaws.com/git-http/111122223333/ap-southeast-1/abc/HuyNguyen260398/cashight.git"
    error_message = "repo URL"
  }
  assert {
    condition     = var.gitops_revision == "cashight-v2" && var.gitops_platform_path == "deploy/platform/"
    error_message = "revision and path"
  }
}

run "collector_reads_cashight_prefix" {
  command = plan
  assert {
    condition     = output.grafana_cloud_parameter_path == "/cashight/grafana-cloud"
    error_message = "SSM path"
  }
}

run "rejects_open_endpoint" {
  command         = plan
  variables { public_access_cidrs = ["0.0.0.0/0"] }
  expect_failures = [var.public_access_cidrs]
}

run "argocd_off_skips_bootstrap" {
  command   = plan
  variables { enable_argocd = false }
  assert {
    condition     = length(module.platform_bootstrap) == 0
    error_message = "bootstrap gated on enable_argocd"
  }
}
```

`terraform test` cannot assert on a resource type's absence. Answer 1c (no published SSM identifiers) is therefore checked by a grep that CI runs (Task 6): `! grep -rn 'resource "aws_ssm_parameter"' terraform/platform terraform/modules/platform_*`.

- [ ] **Step 2: Run it and check that it fails**

Run: `terraform -chdir=terraform/platform init -backend=false && terraform -chdir=terraform/platform test`
Expected: FAIL, with no configuration.

- [ ] **Step 3: Implement the root**

- `versions.tf`: copy the source's, raising `required_version` to `>= 1.11.0`.
- `backend.tf`: key `cashight/platform/terraform.tfstate`, with a comment: workstation only, ephemeral, destroyed with `scripts/platform/destroy-platform.sh`.
- `providers.tf`: copy the source, dropping `profile` and the `--profile` exec args.
- `variables.tf`: from the source, remove `aws_profile`, `argocd_admin_user_ids`, `budget_notification_emails` and `monthly_budget_usd`. Defaults:
  - `resource_prefix = "cashight"`
  - `vpc_cidr = "10.0.0.0/16"`
  - `github_owner = "HuyNguyen260398"`
  - `github_repository = "cashight"`
  - `gitops_revision = "cashight-v2"`
  - `gitops_platform_path = "deploy/platform/"`
  - `enable_argocd = true`
  - node defaults as in Task 2

  Keep the `public_access_cidrs` validation.
- `main.tf`:
  - Locals: `base = data.terraform_remote_state.platform_base.outputs`, `gitops_repo_url = "${local.base.codeconnections_git_http_base}/${var.github_owner}/${var.github_repository}.git"`, `grafana_cloud_parameter_path = "/cashight/grafana-cloud"`, and tags with `Environment = "v2"`.
  - The `platform_root_inputs` check.
  - `module "platform_cluster"`, with `environment = "v2"` and Identity Center, group and connection inputs from `local.base`.
  - `module "platform_bootstrap"`, `count = var.enable_argocd ? 1 : 0`, passing `grafana_cloud_parameter_path`.
- `outputs.tf`: as listed in Interfaces.
- `terraform.tfvars.example`: `public_access_cidrs` only, plus commented optional overrides.

- [ ] **Step 4: Run the tests and check that they pass**

Run: `terraform -chdir=terraform/platform fmt -check && terraform -chdir=terraform/platform validate && terraform -chdir=terraform/platform test`
Expected: `5 passed, 0 failed`.

- [ ] **Step 5: TFLint and Checkov**

Copy `../aws-eks-infra/.tflint.hcl` to `terraform/platform/.tflint.hcl` and `terraform/platform-base/.tflint.hcl`. Copy `../aws-eks-infra/.checkov.yml` to `terraform/platform/.checkov.yml`.
Run: `for r in platform-base platform; do (cd terraform/$r && tflint --init && tflint --recursive --config "$PWD/.tflint.hcl"); done && checkov -d terraform/platform --config-file terraform/platform/.checkov.yml && checkov -d terraform/platform-base --config-file terraform/platform/.checkov.yml && checkov -d terraform/modules/platform_cluster --config-file terraform/platform/.checkov.yml`
Expected: exit 0. Existing `#checkov:skip` comments carry over with the code.

- [ ] **Step 6: Commit**

```bash
git add terraform/platform .gitignore
git commit -m "feat(platform): add the ephemeral EKS platform root on cashight-v2"
```

- [ ] **Step 7: Targeted plan against real state. Skip this step here and run it as Task 9, Step 4, once `platform-base` is applied**

Run: `terraform -chdir=terraform/platform init && terraform -chdir=terraform/platform plan -target=module.platform_cluster -input=false`
Expected: only `to add`, `0 to change, 0 to destroy`. The plan has no NAT gateway, EIP, Fargate profile or `aws_ssm_parameter`, and 2 nodes. Record the add count in the PR description. **Do not apply.**

## Task 4: `deploy/platform/` GitOps and the collector scripts

**Files:**
- Create: `deploy/platform/**`, by copying `../aws-eks-infra/gitops/platform/**`
- Create: `deploy/workloads/.gitkeep`
- Create: `.yamllint.yml` (from the source; the ignore path becomes `deploy/platform/charts/namespace-config/templates/`)
- Create: `scripts/platform/render-collector.sh`, `check-collector.sh` and `run-local-collector.sh` (from `../aws-eks-infra/scripts/`)
- Create: `scripts/platform/check-deploy-paths.sh`

**Interfaces:**
- Consumes: the cluster-Secret annotations from Task 2 (`gitops_repo_url`, `gitops_revision`, `gitops_platform_path`, `vpc_id`, `aws_region`, `aws_load_balancer_controller_role_arn`, `grafana_cloud_parameter_path`).
- Produces: `deploy/workloads/` as the directory the `platform-workloads` ApplicationSet syncs (4c adds `cashight.yaml` there). Also `scripts/platform/render-collector.sh <out-dir>`, unchanged in interface from the source.

- [ ] **Step 1: Write the failing check** `scripts/platform/check-deploy-paths.sh`

It is a bash script with `set -euo pipefail`, and fails (exit 1, naming file:line) when any of these holds:
- (a) any file under `deploy/` contains `gitops/` or `aws-eks-infra`
- (b) any `path:` in `deploy/platform/bootstrap/*.yaml` or `deploy/platform/config/addons/*.yaml` that is not a Helm-chart-internal path does not start with `deploy/` (these are `/var/log/pods` in the collector values and the relative `../../config/namespaces/values.yaml`; allowlist both by exact string)
- (c) `deploy/workloads/` does not exist

Run it before copying anything: `bash scripts/platform/check-deploy-paths.sh`. Expected: FAIL (c).

- [ ] **Step 2: Copy and edit**

`cp -R ../aws-eks-infra/gitops/platform deploy/platform`, then:
1. In `bootstrap/config-addons.yaml`, set `path: deploy/platform/config/addons`.
2. In `bootstrap/config-namespaces.yaml`, set `path: deploy/platform/charts/namespace-config`. The relative `valueFiles` entry stays.
3. In `bootstrap/config-workloads.yaml`, set `path: deploy/workloads`.
4. In `config/addons/opentelemetry-collector.yaml`, change the second source to `path: deploy/platform/config/observability`, and the init container env to `value: '{{ .metadata.annotations.grafana_cloud_parameter_path }}'` (without the `/grafana-cloud` suffix: the annotation already includes it).
5. In `config/namespaces/values.yaml`, change the header comment paths to `deploy/platform/...`. The `cashight` namespace, quota and LimitRange are unchanged.
6. Add `deploy/workloads/.gitkeep`.

- [ ] **Step 3: Port the collector scripts** into `scripts/platform/`
- `render-collector.sh`: `appset=deploy/platform/config/addons/opentelemetry-collector.yaml`, `kubectl kustomize deploy/platform/config/observability`, and the sed substitution becomes `s|{{ \.metadata\.annotations\.grafana_cloud_parameter_path }}|/cashight/grafana-cloud|g`.
- `check-collector.sh`: change the paths to match. Replace the `published.tf` grep assertion (source line 110) with one that the rendered `fetch-grafana-cloud` init container's parameter env value equals `/cashight/grafana-cloud`.
- `run-local-collector.sh`: `prefix="${GRAFANA_CLOUD_PARAMETER_PATH:-$(terraform -chdir=terraform/platform output -raw grafana_cloud_parameter_path 2>/dev/null || echo /cashight/grafana-cloud)}"`. The `2>/dev/null` fallback is needed because the local drill runs while no cluster state exists.

All three resolve paths relative to the repo root (`cd "$(git rev-parse --show-toplevel)"` at the top).

- [ ] **Step 4: Run every check**

Run:
```bash
bash scripts/platform/check-deploy-paths.sh
yamllint -c .yamllint.yml deploy
helm lint deploy/platform/charts/namespace-config -f deploy/platform/charts/namespace-config/values-test.yaml
helm template namespaces deploy/platform/charts/namespace-config -f deploy/platform/config/namespaces/values.yaml | kubeconform -strict -summary -ignore-missing-schemas
find deploy -name kustomization.yaml -execdir sh -c 'kubectl kustomize . | kubeconform -strict -summary -ignore-missing-schemas' \;
bash scripts/platform/check-collector.sh
```
Expected: every command exits 0. `check-collector.sh` ends with its `PASS` summary, including the new `/cashight/grafana-cloud` assertion.

- [ ] **Step 5: Commit**

```bash
git add deploy .yamllint.yml scripts/platform/{render-collector,check-collector,run-local-collector,check-deploy-paths}.sh
git commit -m "feat(platform): move the Argo CD add-ons and collector checks under deploy/platform"
```

## Task 5: Operational scripts

**Files:**
- Create: `scripts/platform/verify-prerequisites.sh`, `verify-platform.sh`, `destroy-platform.sh`, `platform-info.sh` and `check-repo-access.sh` (from `../aws-eks-infra/scripts/`)

**Interfaces:**
- Consumes: the `terraform/platform` outputs (Task 3) and the `terraform/platform-base` outputs (Task 1).
- Produces:
  - `destroy-platform.sh "destroy platform"`: exit 2 without the literal argument, exit 1 on a guard.
  - `verify-platform.sh`: env `EXPECTED_NODES` (default **2**), `EXPECT_WORKLOADS` (default `false`) and `WORKLOAD_NAMESPACES` (default `cashight`).
  - `check-repo-access.sh <owner> <repo> <revision> <path>`: exit 0 on access, 1 otherwise.

  4c's bring-up and teardown call these.

- [ ] **Step 1: Port `destroy-platform.sh` first, with its guard test**

Edits:
- `ROOT=terraform/platform`.
- The workload guard matches `startswith("deploy/workloads")` and also `startswith("deploy/cashight")` (4c's manifests).
- **Remove `DESTROY_ROOT`** and its branch. The root no longer holds account resources, so the script always runs the bootstrap-targeted destroy and then a full `plan -destroy`/`apply`.
- `cd "$(git rev-parse --show-toplevel)"`.

Test it with vitest, which the repo already uses (it has no bats). `scripts/__tests__/destroy-platform-guard.test.ts` runs the script with a `PATH` whose first entry is a temp dir of stub `terraform` and `kubectl` scripts. The real `jq` is used.
  - `it('refuses without the literal argument')`: exit code 2, and stderr contains `pass the literal argument "destroy platform"`.
  - `it('refuses while a multi-source Application sources deploy/cashight')`: the stub `terraform state list` prints `module.platform_cluster.module.eks.aws_eks_cluster.this[0]`, stub `kubectl get --raw /readyz` exits 0, and stub `kubectl -n argocd get applications -o json` prints `{"items":[{"metadata":{"name":"cashight"},"spec":{"sources":[{"path":"deploy/cashight/overlays/v2"}]}}]}`. Expect exit 1, with stderr containing `workload Applications exist` and `cashight`.
  - `it('refuses while an Ingress exists')`: the same setup with no Applications, and `kubectl get ingress -A -o json` returns one item `cashight/api`. Expect exit 1, with stderr containing `Ingress objects still exist`.

Run: `pnpm test scripts/__tests__/destroy-platform-guard.test.ts`. Expected before the port: FAIL (script missing). After: PASS.

- [ ] **Step 2: Port the remaining four scripts**
- **`verify-platform.sh`:**
  - Every `terraform -chdir=environments/platform` becomes `terraform -chdir=terraform/platform`.
  - `connection` is read from `terraform -chdir=terraform/platform-base output -raw github_connection_arn`.
  - Drop `parameter_prefix` and every assertion on published SSM identifiers.
  - The collector's SSM assertions read `terraform -chdir=terraform/platform output -raw grafana_cloud_parameter_path`.
  - `EXPECTED_NODES` defaults to `2`.
  - Comment paths become `deploy/platform/...`.
- **`check-repo-access.sh`:** it reads the cluster ARN from `terraform/platform` and the Git-HTTP base from `terraform -chdir=terraform/platform-base output -raw codeconnections_git_http_base`, replacing the SSM read on source line 24.
- **`platform-info.sh`:** `root="terraform/platform"`.
- **`verify-prerequisites.sh`:** unchanged apart from comments.

- [ ] **Step 3: Shellcheck**

Run: `shellcheck scripts/platform/*.sh`
Expected: exit 0 at default severity.

- [ ] **Step 4: Run the guard tests and the full suite**

Run: `pnpm test`
Expected: all pass, including the three new guard tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/platform scripts/__tests__/destroy-platform-guard.test.ts
git commit -m "feat(platform): port the verify, destroy and access scripts"
```

## Task 6: CI workflow and runbook

**Files:**
- Create: `.github/workflows/platform-ci.yaml`
- Create: `docs/platform.md`
- Source: `../aws-eks-infra/.github/workflows/{terraform,yaml,shell}-ci.yaml`, `../aws-eks-infra/docs/operations/{deploy-platform,destroy-platform,cluster-access,github-connection,validate-platform,first-deployment-defects}.md`

**Interfaces:**
- Produces: one workflow named `Platform CI`, triggered on `pull_request` into `[main, cashight-v2]` with paths `terraform/platform/**`, `terraform/platform-base/**`, `terraform/modules/platform_*/**`, `deploy/**`, `scripts/platform/**`, `.yamllint.yml` and the workflow file itself. `permissions: contents: read`. Actions are pinned by SHA, in the style of `tf-ci.yaml`.

- [ ] **Step 1: Write the workflow** with four jobs:
  1. **`terraform`**: matrix `root: [platform-base, platform]`. Terraform 1.15.2 (the same action pins as `tf-ci.yaml`). Steps: `fmt -check -recursive -diff`, `init -backend=false`, `validate`, `test`, then `tflint --init && tflint --recursive --config "$PWD/.tflint.hcl"`. The `platform` leg also runs `checkov` (pip-installed, version pinned) over the root and `terraform/modules/platform_cluster`, plus the SSM grep from Task 3 Step 1.
  2. **`yaml`**: setup Helm v3.18.4, kubectl v1.35.0, kubeconform and `yamllint==1.37.1`, then the Task 4 Step 4 commands minus `check-collector.sh`.
  3. **`collector`**: `bash scripts/platform/check-collector.sh` (needs Docker, so it has its own job).
  4. **`shell`**: `shellcheck scripts/platform/*.sh`.

- [ ] **Step 2: Lint the workflow**

Run: `yamllint -c .yamllint.yml .github/workflows/platform-ci.yaml` and, if available, `actionlint .github/workflows/platform-ci.yaml`.
Expected: exit 0.

- [ ] **Step 3: Write `docs/platform.md`**

Merge the six source runbooks into one, with these sections in this order:

1. **Roots and lifecycle:** the table from the open-points file's 1d resolution.
2. **One-time setup:**
   - Apply `platform-base`.
   - Complete the CodeConnections handshake in the console. The GitHub App installation must include `HuyNguyen260398/cashight`.
   - Create the three `/cashight/grafana-cloud/*` parameters.
3. **Bring-up:**
   - `terraform -chdir=terraform/platform apply -target=module.platform_cluster` (Review Focus 4: the bootstrap's `kubernetes_manifest` needs the API server).
   - Then a full `apply`.
   - Then `aws eks update-kubeconfig --name cashight-v2`.
   - Then `scripts/platform/check-repo-access.sh HuyNguyen260398 cashight cashight-v2 deploy/platform`.
   - Then `scripts/platform/verify-platform.sh`.
4. **Cluster access:** from `cluster-access.md`.
5. **Teardown:** `scripts/platform/destroy-platform.sh "destroy platform"`, then the leftover checks from `destroy-platform.md`. The budget and connection survive because they are in `platform-base`.
6. **Known defects:** from `first-deployment-defects.md`.
7. **Cost:** a test day ≈ control plane + 2 × `t4g.large` + Argo CD capability, plus an ALB once 4c adds an Ingress. Keep the source's pricing caveat ("list prices, verify").

Every command uses repo-relative paths, and none mentions `aws-eks-infra`.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/platform-ci.yaml docs/platform.md
git commit -m "ci(platform): add Platform CI and the platform runbook"
```

## Task 7: Rename the Grafana Cloud SSM parameters in code and docs

**Files:**
- Modify: `docs/observability.md` (lines 19–20, 26, 59–73, 116–121)
- Modify: `scripts/local/telemetry-drill.ts:4`, `scripts/local/telemetry-audit.ts:18`, `backend/server/http-server.ts:160` (comments only)

**Interfaces:**
- Consumes: Task 4's `scripts/platform/run-local-collector.sh` with `GRAFANA_CLOUD_PARAMETER_PATH`.

- [ ] **Step 1: Edit**
  - Every `/platform/aws-eks-infra/grafana-cloud/` becomes `/cashight/grafana-cloud/`.
  - "The collector side lives in `aws-eks-infra`" becomes "The collector side lives in `deploy/platform/config/addons/opentelemetry-collector.yaml`".
  - The local-run command becomes `GRAFANA_CLOUD_PARAMETER_PATH=/cashight/grafana-cloud ./scripts/platform/run-local-collector.sh "$LOG_DIR"`.
  - The three code comments name `deploy/platform/config/addons/opentelemetry-collector.yaml` (`transform/allowlist`) and `scripts/platform/run-local-collector.sh`.

- [ ] **Step 2: Check for leftovers**

Run: `git grep -n 'aws-eks-infra' -- ':!docs/superpowers/' ':!docs/aws-cost-review-2026-07.md'`
Expected: no output.

- [ ] **Step 3: Typecheck and tests**

Run: `pnpm tsc --noEmit && pnpm test`
Expected: pass. The edits are comment-only.

- [ ] **Step 4: Create the new parameters and prove the local collector reads them (workstation)**

Follow the updated `docs/observability.md` steps to `put-parameter` the three `/cashight/grafana-cloud/*` values, copying the values from the old parameters with `get-parameter --with-decryption` and never echoing them. Then:
Run: `GRAFANA_CLOUD_PARAMETER_PATH=/platform/does-not-exist ./scripts/platform/run-local-collector.sh "$(mktemp -d)"`. Expected: non-zero exit, naming the missing parameter.
Run: `GRAFANA_CLOUD_PARAMETER_PATH=/cashight/grafana-cloud ./scripts/platform/run-local-collector.sh "$(mktemp -d)"` with the Plan 3 telemetry drill. Expected: the drill's metrics appear in Grafana Cloud, as in Plan 3 Task 8. The old parameters are deleted in Task 9.

- [ ] **Step 5: Commit**

```bash
git add docs/observability.md scripts/local/telemetry-drill.ts scripts/local/telemetry-audit.ts backend/server/http-server.ts
git commit -m "docs(observability): move the Grafana Cloud parameters under /cashight"
```

## Task 8: Record the decisions, then open the PR

**Files:**
- Modify: `docs/superpowers/specs/2026-10-08-eks-migration-design.md`
- Modify: `docs/superpowers/specs/2026-11-05-eks-plan-4-open-points.md` (status line)
- Modify: `CLAUDE.md` (Commands table)

- [ ] **Step 1: Edit the spec**
  - In §1, strike the "Platform ownership" row's choice and add "Revised 2026-11-05: platform lives in `cashight` (`terraform/platform-base`, `terraform/platform`, `deploy/platform`); see the open-points file".
  - Add a row: "Environment (2026-11-05): v2 is a repeatable on-demand test environment; cutover (phases 6–7) parked".
  - At the top of §4.1 and §6, add a one-line note pointing at the Plan 2 revision and at F5 (2 × `t4g.large` on-demand).
  - Change the status line to `accepted; revised 2026-11-05`.
- [ ] **Step 2: Edit the open-points file** status to `all points answered; Plan 4a written (docs/superpowers/plans/2026-11-05-eks-migration-04a-platform-port.md)`.
- [ ] **Step 3: Add to `CLAUDE.md`'s Commands table:**
  - `Platform bring-up / teardown | see docs/platform.md`
  - `Platform checks | bash scripts/platform/check-deploy-paths.sh && bash scripts/platform/check-collector.sh`
- [ ] **Step 4: Full verification**

Run: `pnpm lint && pnpm tsc --noEmit && pnpm test && terraform -chdir=terraform fmt -check -recursive && git diff --stat origin/cashight-v2 -- terraform/*.tf terraform/grafana terraform/modules/{api,auth,cicd,compute,data,edge,observability}`
Expected: everything passes, and the last command prints nothing, because the v1 roots and modules are untouched.

- [ ] **Step 5: Commit, push and open the PR**

```bash
git add docs/superpowers/specs CLAUDE.md
git commit -m "docs: record platform ownership in cashight and the test-env lifecycle"
git push -u origin feat/platform-port
gh pr create --base cashight-v2 --title "feat(platform): port the EKS platform into cashight" --body "<summary, validation commands from Tasks 1-7, Task 3 Step 7 add count>"
```
Expected: `Platform CI`, `Terraform CI` and `CI` are green, and no `Application Deploy` or `Infrastructure Deploy` run is triggered.

## Task 9: Live switchover (workstation, after the Task 8 PR is merged)

**Interfaces:**
- Consumes: the merged roots (Tasks 1, 3), and `../aws-eks-infra` checked out at `f24ac9b` with its `backend.hcl` and `terraform.tfvars`.

- [ ] **Step 1: Inventory what `aws-eks-infra` holds**

Run: `terraform -chdir=../aws-eks-infra/environments/platform state list` and `terraform -chdir=../aws-eks-infra/bootstrap/terraform-state state list`.
Expected: no `module.platform_cluster.module.eks.aws_eks_cluster*` entry. If one is there, **stop**: a cluster exists, and its teardown needs `destroy-platform.sh` from that repo first. Record both lists in the PR.

- [ ] **Step 2: Apply `platform-base`**

Run: `eval "$(aws configure export-credentials --format env)" && terraform -chdir=terraform/platform-base init && terraform -chdir=terraform/platform-base apply`
Expected: adds the budget, group, memberships and connection. `0 to change, 0 to destroy`.

- [ ] **Step 3: Complete the CodeConnections handshake**

Complete it in the console (`docs/platform.md` §2). The GitHub App installation must include `HuyNguyen260398/cashight`.
Run: `aws codeconnections get-connection --connection-arn "$(terraform -chdir=terraform/platform-base output -raw github_connection_arn)" --query Connection.ConnectionStatus --output text`
Expected: `AVAILABLE`.

- [ ] **Step 4: Targeted plan of `terraform/platform`**

This is Task 3, Step 7. Expected: additions only, and no apply.

- [ ] **Step 5: Confirm the new budget is live**

Run: `aws budgets describe-budget --account-id "$(aws sts get-caller-identity --query Account --output text)" --budget-name cashight-account-monthly --query 'Budget.BudgetName' --output text`
Expected: `cashight-account-monthly`.

- [ ] **Step 6: Destroy the `aws-eks-infra` platform root**

Run: `terraform -chdir=../aws-eks-infra/environments/platform destroy`
Expected: destroys exactly what Step 1 listed for that root (budget `aws-eks-infra-account-monthly`, group `aws-eks-infra-argocd-admins` and its memberships, connection `aws-eks-infra-github`, and any published SSM parameters). Nothing named `cashight-*` appears in the plan.

- [ ] **Step 7: Destroy the `aws-eks-infra` state bucket**

This root's own state lives in the bucket it destroys, so the order is:
1. Add a gitignored `backend_override.tf` containing `terraform { backend "local" {} }`, then run `terraform -chdir=../aws-eks-infra/bootstrap/terraform-state init -migrate-state`.
2. Empty every object version and delete marker in `aws-eks-infra-<account>-ap-southeast-1-tfstate`, using the existing `pnpm tsx scripts/delete-versioned-s3-bucket.ts` if its arguments fit, otherwise `aws s3api delete-objects` over `list-object-versions`.
3. Run `terraform -chdir=../aws-eks-infra/bootstrap/terraform-state destroy`.

Expected: the bucket is gone, and the KMS key `alias/aws-eks-infra-terraform-state` is scheduled for deletion (30 days). Then delete the local state file and `backend_override.tf`.

- [ ] **Step 8: Delete the old Grafana parameters**

Run: `aws ssm delete-parameters --names /platform/aws-eks-infra/grafana-cloud/otlp-token /platform/aws-eks-infra/grafana-cloud/otlp-endpoint /platform/aws-eks-infra/grafana-cloud/instance-id`
Expected: `DeletedParameters` lists all three. Then `aws ssm get-parameters-by-path --path /platform --recursive --query 'Parameters[].Name'` returns `[]`.

## Task 10: Revert `aws-eks-infra` to the generic reference

**Files:** the whole `aws-eks-infra` repo, reverted to its #16 content.

- [ ] **Step 1: Branch and revert, newest first**

```bash
cd ../aws-eks-infra && git switch main && git pull && git switch -c revert/generic-reference
git revert --no-edit f24ac9b d45a225
```
Expected: two revert commits, no conflicts. The commits are linear (single parent each), so `-m` is not needed.

- [ ] **Step 2: Check that the tree matches #16**

Run: `git diff 7badc4f --stat`
Expected: no output.

- [ ] **Step 3: Run that repo's own checks**

Run: `make terraform-check yaml-check shell-check`
Expected: exit 0. This is the #16 tree, which passed these checks when it merged.

- [ ] **Step 4: Push and open the PR into `main`**

```bash
git push -u origin revert/generic-reference
gh pr create --base main --title "revert: return to the generic EKS reference platform" --body "Cashight's platform now lives in HuyNguyen260398/cashight (terraform/platform-base, terraform/platform, deploy/platform). Reverts #18 and #17. Live resources from those were destroyed first. Tree equals 7badc4f."
```
Expected: that repo's CI is green. Merge once it passes.

## Done when

- `terraform/platform-base` is applied, with budget `cashight-account-monthly` and connection `cashight-github` `AVAILABLE`. `terraform/platform` plans additions only, and **no cluster exists**.
- `Platform CI`, `Terraform CI` and `CI` are green on the merged PR into `cashight-v2`. `main` is unchanged, and no deploy workflow ran.
- `git grep -n 'aws-eks-infra' -- ':!docs/superpowers/' ':!docs/aws-cost-review-2026-07.md'` prints nothing.
- `/cashight/grafana-cloud/*` exist, `/platform/*` is empty, and the local collector run reaches Grafana Cloud from the new path.
- No resource remains in `aws-eks-infra` state: both roots are destroyed and its state bucket is gone.
- `aws-eks-infra` `main` equals `7badc4f`'s tree, via the merged revert PR.
- The spec and `CLAUDE.md` record the new ownership. The open-points file points at this plan.

## Handover to Plan 4b

- `terraform/platform` exposes `cluster_name`, `cluster_arn`, `keda_operator_role_arn` and `otel_collector_role_arn`. The workload Pod Identity roles and KEDA scaler roles go in **`terraform/platform/`** (ephemeral: their associations need the cluster), and read the v2 data-store ARNs from `terraform/` outputs via `terraform_remote_state`. The scaler roles must trust `keda_operator_role_arn` for `sts:AssumeRole` and `sts:TagSession`, and hold only `sqs:GetQueueAttributes` on their own queue (Plan 2 Task 5 contract, unchanged).
- The `cashight` namespace contract (Pod Security `restricted`, default-deny NetworkPolicies, `cashight-defaults` LimitRange, `cashight-quota`) is unchanged. Workloads bring their own allow-policies, including egress to `observability` on TCP 4318.
- HTTPS on the shared ALB (`platform-public`, currently HTTP :80 only) needs the `api.cashight-v2.nghuy.link` certificate from 4b. Jenkins is gone, so changing `listen-ports` touches only Cashight's Ingress.
