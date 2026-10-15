# EKS Migration, Plan 2 of 5: Prerequisites and Platform Capacity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the migration's phase 0 prerequisites, then give the `aws-eks-infra` platform the EC2 capacity, add-ons, KEDA and `cashight` namespace that Plans 3 and 4 build on, and bring it up in the account so `verify-platform.sh` passes with EC2 nodes.

**Architecture:** Phase 0 is account and repository hygiene in `cashight`: the admin Terraform CI role gets a human-approved GitHub environment of its own, and the workflow is proven to plan. Phase 1 lives in `aws-eks-infra`. Terraform adds one Graviton managed node group (3 × `t4g.large`, one per AZ), the network add-ons that EC2 nodes need, the EBS CSI driver and two EKS Pod Identity roles, an account budget, and SSM parameters that publish the identifiers other repositories consume. Argo CD adds KEDA, a default `gp3` StorageClass and the guarded `cashight` namespace. Fargate keeps the platform add-ons it runs today.

**Tech Stack:** Terraform ≥ 1.10 (AWS provider 6.x, `terraform-aws-modules/eks` 21.x), Amazon EKS 1.35, EKS managed add-ons (VPC CNI, kube-proxy, Pod Identity Agent, EBS CSI driver, CoreDNS), EKS Pod Identity, KEDA 2.21.0 (Helm), Argo CD (EKS managed capability), Helm, Kustomize, bash + `jq`, GitHub Actions environments.

**Spec:** `docs/superpowers/specs/2026-10-08-eks-migration-design.md` — §1 (decisions), §4.1 (platform changes), §4.2 (workload sizes), §5 phases 0 and 1, §6 (cost), §7 (risks), §9 open point 3 (decided: **3 nodes**).

## Revision 2026-10-15 — cost cut-down (supersedes Tasks 3–9 below where they differ)

Decided with the user before the Stage 4 apply, after pricing showed the design as written would cost ≈ $575/month (Fargate pods ≈ $112, managed Argo CD + Applications ≈ $44, Jenkins ≈ $50, NAT $47, 3 on-demand nodes $186), not the spec's ≈ $345. Nothing billable had been created.

| Decision | Replaces |
|---|---|
| Strip `aws-eks-infra` to what Cashight needs: remove Jenkins + EFS, ACK + kro, `ack_iam_role_selector`, ADOT/CloudWatch observability, OpenTelemetry Operator, EBS CSI + `gp3` class, VPC flow logs | §4.1 "Fargate stays", Tasks 3–4 EBS CSI, Task 8 Jenkins handling |
| **One Spot Graviton node** (`t4g.medium`, 2 vCPU / 4 GiB; same-size types only), prefix delegation + `maxPods: 110`, 20 GB root | §9.3 "3 nodes", Task 3 `t4g.large` × 3 |
| No Fargate at all; the node is in a **public subnet**, **no NAT gateway** | Task 3 label-scoped Fargate profile + SG bridge |
| **Managed Argo CD deferred** behind `enable_argocd` (default `false`); capability, role, access entry and bootstrap module are gated, `gitops/` is kept for later | §4.5 GitOps from day one; Task 9 Stages 5–7 |
| Telemetry decided in Plan 3 (self-hosted vs hosted); EBS CSI returns only if Plan 3 needs volumes | §4.6 self-hosted Grafana stack (open again) |
| **No cluster apply now.** Stages 1–3 are live (state bucket, budget, Identity Center group, CodeConnections — near-zero cost). The cluster is created when Argo CD and Cashight are ready (Plan 4) | Task 9 Steps 6–14 |

Facts that drove it: the account's 12-month free tier ended 2025-04 (created 2024-04-18); only the `t4g.small` free trial applies (750 h/month to 2026-12-31), and a 2 GiB / 11-Pod `t4g.small` cannot hold the controllers plus Cashight. The EKS control plane ($73) has no free tier.

Resulting run cost: ≈ $96/month without Argo CD; + ≈ $27 + $1.32/Application with Argo CD; + ≈ $26 ALB once Cashight has an Ingress.

**Contracts for Plan 4 that changed:**
- Worker memory: Lambda-sized requests (1.5 GiB, 2 GiB) do not fit a 4 GiB node beside the controllers. Plan 4 measures real usage and sets requests (~0.75 GiB) with burst limits, or raises `node_instance_types` to 8 GiB types (one variable).
- Node security group admits the control plane only on 10250, 4443, 6443, 8443, 9443: any admission webhook or APIService must use one of those ports.
- Argo CD must be turned on (`enable_argocd = true`, staged apply — `docs/operations/deploy-platform.md` Stage 5) before Cashight's Application can sync. `scripts/check-repo-access.sh` then proves access to `cashight`.
- The SSM identifiers, the KEDA operator role trust contract (Task 5) and the `cashight` namespace contract (Task 6) are unchanged.

Commits on `aws-eks-infra` `feat/ec2-capacity-keda` (PR #17): the Task 2–8 commits, then `6c8de00` (remove unused components), `3a1e10c` (single Spot node, no Fargate/NAT), `71ba076` (`enable_argocd`), `a297738` (docs and scripts), and the provider lock bump. Validation: `make terraform-check` / `yaml-check` / `shell-check` exit 0; a read-only `terraform plan` against live state shows `73 to add, 0 to change, 0 to destroy` with no NAT, EIP, Fargate, EFS or capability resources.

## Where this plan sits

| Plan | Phases (spec §5) | Repo |
|---|---|---|
| 1 — Backend container runtime | 3 | `cashight` — **done** (PR #135) |
| **2 — Prerequisites and platform capacity (this plan)** | 0, 1 | `cashight`, `aws-eks-infra` |
| 3 — Observability stack | 2 | `aws-eks-infra` |
| 4 — Cashight AWS resources, GitOps manifests, image pipeline, v2 SPA | 4, 5 | both |
| 5 — Parallel run, retire, rename | 6, 7 | `cashight` |

## State of the account on 2026-10-15 (read before starting)

Checked while writing this plan; re-check at the start of Task 9.

- **The platform does not exist.** `aws eks list-clusters` is empty, and the Terraform state bucket `aws-eks-infra-010382427026-ap-southeast-1-tfstate` is gone. Task 9 is a greenfield deployment from `docs/operations/deploy-platform.md` Stage 1, not an in-place change.
- `aws-eks-infra`'s local `environments/platform/terraform.tfvars` predates the reusable-reference refactor (#16). It lacks the now-required `github_owner` and `github_repository`, and still pins `gitops_revision = "feat/generic-public-workload-access"`, a branch that has since merged.
- IAM Identity Center is `ACTIVE` (`ssoins-82102956e1ad3c22`). A CodeConnections connection named `github-connection` is `AVAILABLE`. It is **not** the one Terraform creates (`aws-eks-infra-github`); leave it alone.
- Issue #113's role exists: `cashight-github-infra`, with `AdministratorAccess`, trusting only `repo:HuyNguyen260398/cashight:environment:production`. `vars.AWS_INFRA_ROLE_ARN` is set. The workflow's only run (2026-08-15 03:14Z) failed with `Credentials could not be loaded` because the variable was set 21 minutes later, at 03:35Z. It has never been re-run.
- The `production` environment has **no protection rules**, and `application-deploy.yaml` uses it for four deploy jobs. A required reviewer there would hold every app deploy, which is why Task 1 moves the infra workflow to its own environment (decided 2026-10-15).
- Existing budgets are $20–60/month account-wide. Recent spend: Jul $95.03, Aug $17.85, Sep $10.88. The platform adds roughly $345/month (spec §6), so those budgets will start alerting once Task 9 runs.

## Branching and where each task runs

| Tasks | Repo | Branch | PR into |
|---|---|---|---|
| 1 | `cashight` | `fix/infra-ci-environment`, cut from `main` | `main` — fixes the current architecture's CI, so it goes to `main` and is merged forward into `cashight-v2` (spec §1, branching rule) |
| 2–9 | `aws-eks-infra` | `feat/ec2-capacity-keda`, cut from `main` | `main` |
| 10 | `cashight` | `cashight-v2` | — (merge-forward only) |

`aws-eks-infra` conventions apply to Tasks 2–9: one Conventional Commit per task, and the exact validation commands go in the PR description. Run `make terraform-check` for any `.tf` change, `make yaml-check` for any `gitops/` change, and `make shell-check` for any `scripts/` change. CI there never gets AWS credentials. Every live step runs from a workstation.

## Global Constraints

- Region `ap-southeast-1`; account `010382427026`.
- Node group: Graviton `t4g.large`, on-demand, **3 nodes across 3 AZs**, private subnets (spec §4.1, §9.3).
- Fargate stays for the existing system and add-on namespaces (spec §4.1).
- Add-ons: EBS CSI driver and EKS Pod Identity Agent (spec §4.1). EC2 nodes on this cluster also need VPC CNI and kube-proxy, because `terraform-aws-modules/eks` 21.x creates the cluster with `bootstrap_self_managed_addons = false`.
- KEDA is an Argo CD-managed add-on beside cert-manager, AWS Load Balancer Controller, Argo Rollouts and OpenTelemetry Operator (spec §4.1).
- Namespace name `cashight`, created with the existing `namespace-config` chart: quota, limits, default-deny NetworkPolicy. It must **not** match `apps-*`, so its Pods land on EC2 (spec §4.1).
- CodeConnections is extended so managed Argo CD can read the `cashight` repo (spec §4.1).
- Cluster identifiers Cashight needs are published as Terraform outputs and SSM parameters (spec §4.1).
- Ownership invariant (`aws-eks-infra` CLAUDE.md): Terraform owns AWS resources plus the minimal Argo CD bootstrap; Argo CD owns everything under `gitops/`; nothing is managed by both.
- New Terraform-to-GitOps values travel as annotations on the Argo CD cluster Secret. Never hardcode account values in YAML.
- `#checkov:skip=CKV_...: <justification>` goes inline at the resource; `.checkov.yml` stays as it is.
- Existing `cashight.nghuy.link` infrastructure is untouched except for the trust policy of `cashight-github-infra` (Task 1).

## Review Focus

These failure modes are implied by the spec but not exercised by any static check. Each line has a live test in the task that owns it.

1. **Pods on EC2 nodes cannot resolve DNS.** CoreDNS stays on Fargate, where Pods carry the cluster primary security group. Node-group Pods carry the node security group, and neither group admits the other by default. Expected: `nslookup` from an EC2 Pod succeeds. Owner: Task 3 adds the rules; Task 9 Step 11 tests them.
2. **NetworkPolicy objects are accepted but never enforced.** Without `enableNetworkPolicy` on the VPC CNI, the `cashight` namespace's default-deny is decorative. Expected: from a `cashight` Pod, DNS works and plain HTTP egress times out. Owner: Task 3 (config), Task 8 (assert), Task 9 Step 11 (live test).
3. **Pods that need Pod Identity land on Fargate.** The `kube-system` Fargate profile currently takes every `kube-system` Pod, and Pod Identity does not work on Fargate. The EBS CSI controller would start without credentials. Expected: `ebs-csi-controller` and all `keda` Pods run on EC2 nodes, and a `gp3` PVC binds. Owner: Task 3 (narrow selectors), Task 8 (assert), Task 9 Step 11 (PVC smoke).
4. **KEDA's external metrics API is unreachable from the control plane.** The ScaledObjects in Plan 4 would then never scale. Expected: APIService `v1beta1.external.metrics.k8s.io` reports `Available=True`. Owner: Task 5 (install), Task 8 (assert).
5. **Argo CD cannot read the `cashight` repository.** The GitHub App installation behind CodeConnections is limited to the repositories it was granted. Plan 4's Application would sit in `ComparisonError`. Expected: a throwaway Application for `HuyNguyen260398/cashight@cashight-v2` resolves a revision. Owner: Task 7 (script), Task 9 Step 12 (live test).

---

## File map

### `cashight` (Task 1)

| File | Change |
|---|---|
| `terraform/github-oidc.tf` | Trust `environment:infrastructure` instead of `environment:production`; update comment and description |
| `.github/workflows/infrastructure-deploy.yaml` | `environment: infrastructure` on both jobs |
| `docs/DEPLOYMENT_SERVERLESS.md` | Describe the two environments |

### `aws-eks-infra` (Tasks 2–9)

| File | Task | Responsibility |
|---|---|---|
| `environments/platform/budget.tf` (new) | 2 | Account-wide monthly cost budget with email alerts |
| `environments/platform/variables.tf` | 2, 3 | `monthly_budget_usd`, `budget_notification_emails`, `node_instance_type`, `node_count` |
| `environments/platform/terraform.tfvars.example` | 2, 3 | Document the new inputs |
| `modules/platform_cluster/variables.tf` | 3 | `node_instance_type`, `node_count` with Graviton and range validation |
| `modules/platform_cluster/eks.tf` | 3, 4 | Node group, network add-ons, narrowed `system` Fargate profile, EBS CSI add-on |
| `modules/platform_cluster/compute_ec2.tf` (new) | 3 | Security-group rules between Fargate Pods and node-group Pods |
| `modules/platform_cluster/iam_pod_identity.tf` (new) | 4, 5 | Pod Identity trust policy, EBS CSI role, KEDA operator role and association |
| `modules/platform_cluster/outputs.tf` | 3, 4, 5 | Node group name, node security group, role ARNs |
| `environments/platform/main.tf` | 2, 3, 7 | Pass node inputs; split the CodeConnections base URL out of `gitops_repo_url` |
| `environments/platform/published.tf` (new) | 7 | SSM parameters under `/<prefix>/platform/` |
| `environments/platform/outputs.tf` | 3, 5, 7 | Surface new module outputs and the parameter prefix |
| `gitops/platform/config/addons/keda.yaml` (new) + `kustomization.yaml` | 5 | KEDA ApplicationSet |
| `gitops/platform/bootstrap/config-storage.yaml` (new), `gitops/platform/config/storage/*` (new) | 4 | Default `gp3` StorageClass |
| `gitops/platform/bootstrap/config-namespaces.yaml` (new), `gitops/platform/config/namespaces/values.yaml` (new) | 6 | Tenant namespaces rendered by `namespace-config` |
| `Makefile` | 6 | `helm-check` renders the real tenant values |
| `scripts/check-repo-access.sh` (new) | 7 | Prove Argo CD can read a repository without deploying from it |
| `scripts/verify-platform.sh` | 8 | Acceptance for EC2 capacity, add-ons, KEDA, tenants, published identifiers |
| `CLAUDE.md`, `AGENTS.md`, `README.md`, `docs/operations/{deploy-platform,cluster-access,validate-platform,github-connection}.md`, `gitops/workloads/README.md` | 8 | Replace the Fargate-only invariant with the mixed-capacity one |

---

## Task 1: Give the Terraform CI role its own approval-gated environment (phase 0)

**Repo:** `cashight`. **Branch:** `fix/infra-ci-environment` from `main`.

**Files:**
- Modify: `terraform/github-oidc.tf` (comment block above `github_infra_trust`, the `sub` condition, the role description)
- Modify: `.github/workflows/infrastructure-deploy.yaml:25-28` and `:101`
- Modify: `docs/DEPLOYMENT_SERVERLESS.md` (section "GitHub environment")

**Interfaces:**
- Produces: GitHub environment `infrastructure` with required reviewer `HuyNguyen260398` (user id `22511283`) and deployments limited to `main`. `cashight-github-infra` trusts only `repo:HuyNguyen260398/cashight:environment:infrastructure`.

- [ ] **Step 1: Branch from an up-to-date `main`**

```bash
cd ~/ws/cashight
git fetch origin
git switch -c fix/infra-ci-environment origin/main
```

- [ ] **Step 2: Create the `infrastructure` environment with a required reviewer and a `main`-only branch policy**

```bash
gh api -X PUT repos/HuyNguyen260398/cashight/environments/infrastructure --input - <<'EOF'
{
  "reviewers": [{ "type": "User", "id": 22511283 }],
  "prevent_self_review": false,
  "deployment_branch_policy": { "protected_branches": false, "custom_branch_policies": true }
}
EOF
gh api -X POST repos/HuyNguyen260398/cashight/environments/infrastructure/deployment-branch-policies \
  -f name=main -f type=branch
```

`prevent_self_review` must be `false`: you are the only reviewer and also the person dispatching. `custom_branch_policies` with `main` is used instead of `protected_branches` because `main` is protected by a **ruleset**, and the classic branch-protection API reports it as unprotected (see the `main branch ruleset` memory).

Verify:

```bash
gh api repos/HuyNguyen260398/cashight/environments/infrastructure \
  --jq '{rules: [.protection_rules[].type], branch_policy: .deployment_branch_policy}'
gh api repos/HuyNguyen260398/cashight/environments/infrastructure/deployment-branch-policies --jq '[.branch_policies[].name]'
```

Expected: `rules` contains `"required_reviewers"` and `"branch_policy"`, `custom_branch_policies: true`, and the policy list is `["main"]`.

- [ ] **Step 3: Point the trust policy at the new environment**

In `terraform/github-oidc.tf`, replace the comment block's numbered list:

```hcl
#   1. The trust condition below admits ONLY jobs that declare
#      `environment: production` — not any job running on main. Both the plan and
#      apply jobs declare it.
#   2. That makes GitHub's environment protection the gate. The production
#      environment currently has NO protection rules, so add required reviewers
#      to it — otherwise this is admin-on-merge with no human in the loop.
```

with:

```hcl
#   1. The trust condition below admits ONLY jobs that declare
#      `environment: infrastructure` — not any job running on main. Both the
#      plan and apply jobs declare it.
#   2. That makes GitHub's environment protection the gate. `infrastructure` has
#      a required reviewer and only deploys from main. It is deliberately not
#      `production`: application-deploy.yaml runs four jobs in `production`, and
#      a reviewer there would hold every app deploy for approval.
```

Replace the `sub` condition:

```hcl
    # Environment-scoped only — deliberately narrower than the deploy role, which
    # also admits refs/heads/main.
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repository}:environment:infrastructure"]
    }
```

and the role description:

```hcl
  description          = "Terraform plan/apply from GitHub Actions. Admin-equivalent; gated by the infrastructure environment."
```

- [ ] **Step 4: Move both workflow jobs to the new environment**

In `.github/workflows/infrastructure-deploy.yaml`, the `plan` job becomes:

```yaml
  plan:
    name: Terraform Plan
    runs-on: ubuntu-latest
    # Required: cashight-github-infra trusts only subjects of the form
    # repo:<repo>:environment:infrastructure, so a job without this cannot
    # assume it. The environment's required reviewer is the human gate.
    environment: infrastructure
```

and the `apply` job's `environment: production` becomes `environment: infrastructure`. No other line in the file changes. The `TF_*` secrets are repository-level, so both environments can see them:

```bash
gh api repos/HuyNguyen260398/cashight/environments/production/secrets --jq '.total_count'   # expect 0
```

- [ ] **Step 5: Update the deployment doc**

In `docs/DEPLOYMENT_SERVERLESS.md`, replace the "GitHub environment" section's paragraph with:

```markdown
### GitHub environments

Two environments gate deployments:

| Environment | Used by | Protection |
|---|---|---|
| `production` | `application-deploy.yaml` (Lambda and frontend deploy jobs) | None: deploys run unattended after a PR merges into `main` |
| `infrastructure` | `infrastructure-deploy.yaml` (plan and apply jobs) | Required reviewer; deployments only from `main` |

`cashight-github-infra` is admin-equivalent and trusts only `repo:HuyNguyen260398/cashight:environment:infrastructure`, so the reviewer approval is what stands between a dispatch and an admin session.
```

Also change the `AWS_INFRA_ROLE_ARN` table row's value to `` `terraform output github_infra_role_arn` ``.

- [ ] **Step 6: Plan the trust change from the workstation**

The CI role cannot change its own trust before CI can assume it, so this one apply runs locally. Bridge the `aws login` session first (see the `Terraform AWS auth bridge` memory):

```bash
eval "$(aws configure export-credentials --format env)"
cd ~/ws/cashight/terraform
terraform init -input=false
terraform plan -input=false -out=tfplan-infra-env
```

Expected: `Plan: 0 to add, 1 to change, 0 to destroy.` The single change is `aws_iam_role.github_infra`: `assume_role_policy` (`environment:production` → `environment:infrastructure`) and `description`.

**Stop if the plan shows anything else.** Other changes are drift, and they need their own decision. Record the plan summary in the PR description, and do not apply.

- [ ] **Step 7: Apply it**

```bash
terraform apply tfplan-infra-env
rm tfplan-infra-env
aws iam get-role --role-name cashight-github-infra \
  --query 'Role.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals."token.actions.githubusercontent.com:sub"' --output text
```

Expected: `repo:HuyNguyen260398/cashight:environment:infrastructure`.

- [ ] **Step 8: Commit, open the PR into `main`, merge when CI is green**

```bash
cd ~/ws/cashight
git add terraform/github-oidc.tf .github/workflows/infrastructure-deploy.yaml docs/DEPLOYMENT_SERVERLESS.md
git commit -m "fix(ci): gate the Terraform CI role behind its own infrastructure environment

The admin-equivalent cashight-github-infra role trusted the production
environment, which has no reviewers because application-deploy runs four
jobs there. Move it to a dedicated infrastructure environment with a
required reviewer and a main-only branch policy. The trust change was
applied from a workstation (1 to change)."
git push -u origin fix/infra-ci-environment
gh pr create --base main --title "fix(ci): gate the Terraform CI role behind its own infrastructure environment" \
  --body "Phase 0 of the EKS migration (spec §5). Moves infrastructure-deploy.yaml and the cashight-github-infra trust policy from the unprotected production environment to a new infrastructure environment (required reviewer, main only). Trust change already applied from a workstation: Plan 0 to add, 1 to change, 0 to destroy. Validation: terraform plan; gh api …/environments/infrastructure."
```

Merging into `main` triggers `application-deploy.yaml`. That redeploys the unchanged app code, which is expected and harmless.

- [ ] **Step 9: Prove the infra workflow can plan (phase 0 exit criterion)**

```bash
gh workflow run infrastructure-deploy.yaml --ref main -f action=plan
sleep 5
run_id="$(gh run list --workflow=infrastructure-deploy.yaml --limit 1 --json databaseId --jq '.[0].databaseId')"
gh run view "$run_id" --web
```

The `Terraform Plan` job waits for review. **The user approves it in the GitHub UI.** The executor does not approve on the user's behalf. Then:

```bash
gh run watch "$run_id" --exit-status
gh run view "$run_id" --log | grep -E '^.*(Plan:|No changes\.)' | tail -1
```

Expected: the run succeeds, and the summary is `No changes.` Any `Plan:` line with changes is drift between `main` and the account. Record it in the PR thread and **do not dispatch `apply`**. It is not this plan's to fix.

---

## Task 2: Account budget alarm (phase 0)

**Repo:** `aws-eks-infra`. **Branch:** `feat/ec2-capacity-keda` from `main`. Every later `aws-eks-infra` task commits to this branch.

**Files:**
- Create: `environments/platform/budget.tf`
- Modify: `environments/platform/variables.tf` (append)
- Modify: `environments/platform/terraform.tfvars.example` (append)

**Interfaces:**
- Produces: `aws_budgets_budget.account_monthly`, the target address Task 9 applies before anything that costs money.

The budget is **account-wide** on purpose. A budget filtered on the `Project` tag would only match once that tag is activated as a cost allocation tag, and AWS only offers a tag for activation after it has appeared on billed usage. On a greenfield deploy that is a day after the spend starts, which is exactly when the alarm is needed.

- [ ] **Step 1: Branch**

```bash
cd ~/ws/aws-eks-infra
git fetch origin
git switch -c feat/ec2-capacity-keda origin/main
```

- [ ] **Step 2: Add the variables**

Append to `environments/platform/variables.tf`:

```hcl
variable "monthly_budget_usd" {
  description = "Account-wide monthly cost budget in USD. Alerts fire at 50%, 80% and 100% of actual spend and at 100% of forecast spend."
  type        = number
  default     = 400

  validation {
    condition     = var.monthly_budget_usd > 0
    error_message = "monthly_budget_usd must be greater than zero."
  }
}

variable "budget_notification_emails" {
  description = "Email addresses notified by the account budget. AWS Budgets sends to them directly; no subscription confirmation is needed."
  type        = set(string)

  validation {
    condition = length(var.budget_notification_emails) > 0 && alltrue([
      for email in var.budget_notification_emails : can(regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", email))
    ])
    error_message = "budget_notification_emails must contain at least one valid email address."
  }
}
```

- [ ] **Step 3: Run validate to see it fail on the missing resource wiring**

```bash
terraform -chdir=environments/platform init -backend=false -input=false >/dev/null
terraform -chdir=environments/platform validate
```

Expected: `Success!` The variables are declared but unused, and Terraform does not reject unused variables. TFLint does: `make terraform-lint` reports `terraform_unused_declarations` for both. That lint failure is the red state for this task.

- [ ] **Step 4: Create the budget**

`environments/platform/budget.tf`:

```hcl
# Account-wide, not tag-filtered: a tag only becomes a usable budget filter
# after it is activated as a cost allocation tag, and AWS offers a tag for
# activation only once it has appeared on billed usage — a day after the spend
# this alarm exists to catch. Apply this resource before the cluster (see
# docs/operations/deploy-platform.md, Stage 3).
locals {
  budget_notifications = {
    actual_50     = { type = "ACTUAL", threshold = 50 }
    actual_80     = { type = "ACTUAL", threshold = 80 }
    actual_100    = { type = "ACTUAL", threshold = 100 }
    forecast_100  = { type = "FORECASTED", threshold = 100 }
  }
}

resource "aws_budgets_budget" "account_monthly" {
  name         = "${var.resource_prefix}-account-monthly"
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  dynamic "notification" {
    for_each = local.budget_notifications

    content {
      comparison_operator        = "GREATER_THAN"
      notification_type          = notification.value.type
      threshold                  = notification.value.threshold
      threshold_type             = "PERCENTAGE"
      subscriber_email_addresses = var.budget_notification_emails
    }
  }

  tags = local.tags
}
```

Run `terraform fmt environments/platform` and accept its alignment of the `budget_notifications` map.

- [ ] **Step 5: Document the inputs**

Append to `environments/platform/terraform.tfvars.example`:

```hcl

# Required. Account-wide monthly cost budget alerts. The platform alone costs
# roughly USD 345/month (control plane, three t4g.large nodes, NAT, ALB).
budget_notification_emails = ["you@example.com"]
# monthly_budget_usd       = 400
```

- [ ] **Step 6: Run the gates**

```bash
make terraform-check
```

Expected: exit 0. TFLint no longer reports unused declarations, and Checkov reports no new failures.

- [ ] **Step 7: Commit**

```bash
git add environments/platform/budget.tf environments/platform/variables.tf environments/platform/terraform.tfvars.example
git commit -m "feat(platform): add an account-wide monthly budget alarm"
```

---

## Task 3: Graviton node group, network add-ons, and Fargate/EC2 coexistence

**Files:**
- Modify: `modules/platform_cluster/variables.tf` (append)
- Modify: `modules/platform_cluster/eks.tf` (`addons`, `fargate_profiles.system`, new `eks_managed_node_groups`)
- Create: `modules/platform_cluster/compute_ec2.tf`
- Modify: `modules/platform_cluster/outputs.tf` (append)
- Modify: `environments/platform/variables.tf`, `environments/platform/main.tf` (`module "platform_cluster"`), `environments/platform/outputs.tf`, `environments/platform/terraform.tfvars.example`

**Interfaces:**
- Consumes: `module.vpc.private_subnets`, `local.cluster_name`.
- Produces: node group `<cluster>-general` (`aws-eks-infra-platform-general` with the default prefix); module outputs `node_group_name` (string) and `node_security_group_id` (string); root output `node_security_group_id`. Task 8's verify script relies on the node group name, the node label `eks.amazonaws.com/nodegroup`, and the add-on names `vpc-cni`, `kube-proxy`, `eks-pod-identity-agent`.

- [ ] **Step 1: Add the module inputs**

Append to `modules/platform_cluster/variables.tf`:

```hcl
variable "node_instance_type" {
  description = "Graviton (arm64) EC2 instance type for the general-purpose managed node group."
  type        = string

  validation {
    # Graviton families carry a "g" right after the generation number:
    # t4g, m7g, c7gn, r8gd. x86 types such as m5 or g5 do not match.
    condition     = can(regex("^[a-z]+[0-9]+g[a-z]*\\.[a-z0-9]+$", var.node_instance_type))
    error_message = "node_instance_type must be a Graviton (arm64) type such as t4g.large; the node group uses an arm64 AMI."
  }
}

variable "node_count" {
  description = "Fixed size of the general-purpose managed node group. Nodes spread across the three private subnets."
  type        = number

  validation {
    condition     = var.node_count >= 1 && var.node_count <= 10 && floor(var.node_count) == var.node_count
    error_message = "node_count must be a whole number from 1 to 10."
  }
}
```

- [ ] **Step 2: See validation fail before the module receives the inputs**

```bash
terraform -chdir=environments/platform init -backend=false -input=false >/dev/null
terraform -chdir=environments/platform validate
```

Expected: FAIL. `Missing required argument … "node_count" … "node_instance_type"` on `module "platform_cluster"`.

- [ ] **Step 3: Add the root inputs and pass them through**

Append to `environments/platform/variables.tf`:

```hcl
variable "node_instance_type" {
  description = "Graviton (arm64) EC2 instance type for the general-purpose managed node group."
  type        = string
  default     = "t4g.large"
}

variable "node_count" {
  description = "Fixed size of the general-purpose managed node group, one node per Availability Zone at the default of 3."
  type        = number
  default     = 3
}
```

In `environments/platform/main.tf`, add to the `module "platform_cluster"` block after `kubernetes_version`:

```hcl
  node_instance_type           = var.node_instance_type
  node_count                   = var.node_count
```

Append to `environments/platform/terraform.tfvars.example`:

```hcl

# Optional. General-purpose Graviton node group; one node per AZ at 3.
# node_instance_type = "t4g.large"
# node_count         = 3
```

- [ ] **Step 4: Add the node group, the network add-ons, and narrow the `system` Fargate profile**

In `modules/platform_cluster/eks.tf`, replace the `addons = { … }` block with:

```hcl
  # vpc-cni, kube-proxy and the Pod Identity Agent are created before the node
  # group (before_compute): the module builds the cluster with
  # bootstrap_self_managed_addons = false, so without them EC2 nodes never
  # become Ready. enableNetworkPolicy makes the VPC CNI enforce NetworkPolicy
  # objects; without it they are accepted and silently ignored. Fargate Pods
  # are never subject to NetworkPolicy either way.
  #
  # CoreDNS must be created *after* the Fargate profiles. before_compute = true
  # would schedule it while no profile selects it, so the add-on sits DEGRADED
  # until it times out. The ADOT add-on is deliberately absent: it hard-requires
  # cert-manager, so Argo CD installs cert-manager and the OpenTelemetry
  # operator instead. Terraform still owns the ADOT IRSA role.
  addons = {
    vpc-cni = {
      before_compute = true
      configuration_values = jsonencode({
        enableNetworkPolicy = "true"
      })
    }
    kube-proxy = {
      before_compute = true
    }
    eks-pod-identity-agent = {
      before_compute = true
    }
    coredns = {
      configuration_values = jsonencode({
        computeType = "Fargate"
      })
      # EKS creates the default CoreDNS Deployment when the cluster is created,
      # before any Fargate profile exists, so those first Pods are permanently
      # unschedulable and the add-on reports DEGRADED. Clearing it needs a
      # `kubectl -n kube-system rollout restart deployment coredns` once the
      # kube-system profile is ACTIVE — see docs/operations/deploy-platform.md.
      # The default 20m create timeout leaves no room for that manual step.
      timeouts = {
        create = "40m"
      }
    }
  }
```

Replace the `system` entry of `fargate_profiles` with:

```hcl
    # Label-scoped, not the whole namespace: the VPC CNI, kube-proxy, Pod
    # Identity Agent and EBS CSI driver also live in kube-system and must run
    # on EC2. DaemonSets cannot run on Fargate, and EKS Pod Identity does not
    # work there. Only CoreDNS and the load balancer controller (IRSA) stay.
    system = {
      name            = "${local.cluster_name}-system"
      subnet_ids      = module.vpc.private_subnets
      create_iam_role = false
      iam_role_arn    = aws_iam_role.fargate_pod_execution.arn
      selectors = [
        { namespace = "kube-system", labels = { "k8s-app" = "kube-dns" } },
        { namespace = "kube-system", labels = { "app.kubernetes.io/name" = "aws-load-balancer-controller" } },
      ]
    }
```

After the `fargate_profiles` block, still inside `module "eks"`, add:

```hcl
  # One fixed-size Graviton node group for workloads Fargate cannot host:
  # EBS-backed StatefulSets, DaemonSet collectors, and Pods using EKS Pod
  # Identity. No cluster autoscaler: KEDA scales Pods, not nodes. The launch
  # template defaults to IMDSv2 with a hop limit of 1, so Pods cannot reach
  # the node role's credentials through instance metadata.
  eks_managed_node_groups = {
    general = {
      name            = "${local.cluster_name}-general"
      use_name_prefix = false
      # The module's default role name ("<name>-eks-node-group" as a prefix)
      # exceeds IAM's 38-character name_prefix limit.
      iam_role_name            = "${local.cluster_name}-node"
      iam_role_use_name_prefix = false

      ami_type       = "AL2023_ARM_64_STANDARD"
      instance_types = [var.node_instance_type]
      capacity_type  = "ON_DEMAND"
      subnet_ids     = module.vpc.private_subnets

      min_size     = var.node_count
      max_size     = var.node_count
      desired_size = var.node_count

      block_device_mappings = {
        xvda = {
          device_name = "/dev/xvda"
          ebs = {
            volume_size           = 50
            volume_type           = "gp3"
            encrypted             = true
            delete_on_termination = true
          }
        }
      }

      update_config = {
        max_unavailable = 1
      }

      node_repair_config = {
        enabled = true
      }
    }
  }
```

- [ ] **Step 5: Let Fargate Pods and node-group Pods reach each other**

Create `modules/platform_cluster/compute_ec2.tf`:

```hcl
# Fargate Pods carry the cluster primary security group. Node-group Pods carry
# the node security group the EKS module creates. Neither group admits the
# other by default, so without these rules EC2 Pods cannot resolve DNS
# (CoreDNS runs on Fargate) and Fargate controllers cannot call webhooks or
# metrics endpoints served from nodes. Pod-to-Pod policy inside a namespace is
# NetworkPolicy's job, not the security groups'.

resource "aws_vpc_security_group_ingress_rule" "fargate_from_nodes" {
  security_group_id            = module.eks.cluster_primary_security_group_id
  description                  = "All traffic from node-group Pods to Fargate Pods"
  ip_protocol                  = "-1"
  referenced_security_group_id = module.eks.node_security_group_id

  tags = var.tags
}

resource "aws_vpc_security_group_ingress_rule" "nodes_from_fargate" {
  security_group_id            = module.eks.node_security_group_id
  description                  = "All traffic from Fargate Pods to node-group Pods"
  ip_protocol                  = "-1"
  referenced_security_group_id = module.eks.cluster_primary_security_group_id

  tags = var.tags
}
```

- [ ] **Step 6: Expose the node group**

Append to `modules/platform_cluster/outputs.tf`:

```hcl
output "node_group_name" {
  description = "Name of the general-purpose EKS managed node group."
  # node_group_id is "<cluster>:<node group>".
  value = element(split(":", module.eks.eks_managed_node_groups["general"].node_group_id), 1)
}

output "node_security_group_id" {
  description = "Security group attached to general node-group instances and their Pods. The AWS Load Balancer Controller adds ALB ingress rules to it."
  value       = module.eks.node_security_group_id
}
```

Append to `environments/platform/outputs.tf`:

```hcl
output "node_group_name" {
  description = "Name of the general-purpose EKS managed node group."
  value       = module.platform_cluster.node_group_name
}

output "node_security_group_id" {
  description = "Security group attached to general node-group instances and their Pods."
  value       = module.platform_cluster.node_security_group_id
}
```

- [ ] **Step 7: Run the gates**

```bash
terraform fmt -recursive
make terraform-check
```

Expected: exit 0. If Checkov flags the two `aws_vpc_security_group_ingress_rule` resources for allowing all protocols, add this as the first line inside each one, using the exact check ID Checkov printed:

```hcl
  #checkov:skip=<ID>: Source is a security group, not a CIDR; Fargate and node-group Pods are one trust zone and NetworkPolicy governs Pod traffic.
```

and re-run. Do not add any other skip.

- [ ] **Step 8: Check that an x86 instance type is rejected**

```bash
terraform -chdir=environments/platform plan -input=false -refresh=false -lock=false \
  -var 'node_instance_type=m5.large' -var 'github_owner=x' -var 'github_repository=y' \
  -var 'public_access_cidrs=["203.0.113.10/32"]' -var 'argocd_admin_user_ids=["u"]' \
  -var 'budget_notification_emails=["a@b.co"]' 2>&1 | grep -F 'must be a Graviton'
```

Expected: the error line is printed. The plan may fail earlier for lack of credentials or backend; only the `grep` result matters. If `grep` prints nothing, the plan failed before it evaluated variables. In that case, check with `terraform -chdir=environments/platform console -var 'node_instance_type=m5.large' …` instead.

- [ ] **Step 9: Commit**

```bash
git add modules/platform_cluster environments/platform
git commit -m "feat(platform): add a Graviton managed node group beside Fargate

Three t4g.large on-demand nodes, one per AZ, for workloads Fargate cannot
host. Adds the VPC CNI (NetworkPolicy enforcement on), kube-proxy and the
Pod Identity Agent before compute, narrows the kube-system Fargate profile
to CoreDNS and the load balancer controller, and opens the security groups
between Fargate and node-group Pods so EC2 Pods can reach CoreDNS."
```

---

## Task 4: EBS CSI driver on Pod Identity and a default `gp3` StorageClass

**Files:**
- Create: `modules/platform_cluster/iam_pod_identity.tf`
- Modify: `modules/platform_cluster/eks.tf` (`addons`: add `aws-ebs-csi-driver`)
- Modify: `modules/platform_cluster/outputs.tf` (append)
- Create: `gitops/platform/bootstrap/config-storage.yaml`
- Create: `gitops/platform/config/storage/kustomization.yaml`, `gitops/platform/config/storage/gp3-storageclass.yaml`

**Interfaces:**
- Consumes: `module.eks.cluster_arn`, `data.aws_caller_identity.current` (declared in `iam_fargate.tf`).
- Produces: `data.aws_iam_policy_document.pod_identity_assume_role` (reused by Task 5), role `<cluster>-ebs-csi-driver`, default StorageClass `gp3` (Plan 3's Loki, Tempo and Mimir volumes rely on it), output `ebs_csi_driver_role_arn`.

- [ ] **Step 1: Write the failing manifest check**

```bash
kubectl kustomize gitops/platform/config/storage
```

Expected: FAIL. `must build at directory: … gitops/platform/config/storage: file does not exist`.

- [ ] **Step 2: Add the StorageClass**

`gitops/platform/config/storage/gp3-storageclass.yaml`:

```yaml
# Default StorageClass for EBS-backed volumes on the general node group.
# WaitForFirstConsumer creates each volume in the AZ its Pod was scheduled to;
# Immediate would pick an AZ first and could strand the Pod.
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: gp3
  annotations:
    storageclass.kubernetes.io/is-default-class: "true"
provisioner: ebs.csi.aws.com
volumeBindingMode: WaitForFirstConsumer
reclaimPolicy: Delete
allowVolumeExpansion: true
parameters:
  type: gp3
  encrypted: "true"
```

`gitops/platform/config/storage/kustomization.yaml`:

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - gp3-storageclass.yaml
```

`gitops/platform/bootstrap/config-storage.yaml`:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: platform-storage
  namespace: argocd
spec:
  # Required: the template below uses Go-template syntax ({{ .name }},
  # {{ .metadata.annotations.* }}). Without this, Argo CD falls back to legacy
  # fasttemplate, which only understands {{name}}/{{server}} and cannot
  # traverse annotations - every Application fails destination validation.
  goTemplate: true
  goTemplateOptions:
    - missingkey=error
  generators:
    - clusters:
        selector:
          matchLabels:
            platform_cluster: "true"
  template:
    metadata:
      name: '{{ .name }}-platform-storage'
    spec:
      project: default
      source:
        repoURL: '{{ .metadata.annotations.gitops_repo_url }}'
        targetRevision: '{{ .metadata.annotations.gitops_revision }}'
        path: gitops/platform/config/storage
      destination:
        server: '{{ .server }}'
        namespace: argocd
      syncPolicy:
        automated:
          prune: true
          selfHeal: true
        syncOptions:
          - ServerSideApply=true
```

Check that the Jenkins EFS StorageClass is not also marked default. Two defaults make every PVC without a class ambiguous:

```bash
grep -n "is-default-class" gitops/workloads/charts/jenkins-storage/templates/storageclass.yaml || echo "not default: ok"
```

Expected: `not default: ok`.

- [ ] **Step 3: Run the manifest gates**

```bash
kubectl kustomize gitops/platform/config/storage | kubeconform -strict -summary -ignore-missing-schemas
make yaml-check
```

Expected: `Valid: 1`, then exit 0.

- [ ] **Step 4: Add the Pod Identity trust policy and the EBS CSI role**

`modules/platform_cluster/iam_pod_identity.tf`:

```hcl
# EKS Pod Identity roles. Pod Identity works only on EC2 nodes, never on
# Fargate, so every Pod using these roles must be scheduled on the general
# node group (see the system Fargate profile's label selectors in eks.tf).
# The source conditions stop another account's or cluster's Pod Identity
# agent from assuming these roles (confused deputy).

data "aws_iam_policy_document" "pod_identity_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole", "sts:TagSession"]

    principals {
      type        = "Service"
      identifiers = ["pods.eks.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }

    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = [module.eks.cluster_arn]
    }
  }
}

resource "aws_iam_role" "ebs_csi_driver" {
  name               = "${local.cluster_name}-ebs-csi-driver"
  assume_role_policy = data.aws_iam_policy_document.pod_identity_assume_role.json

  tags = var.tags
}

resource "aws_iam_role_policy_attachment" "ebs_csi_driver" {
  role       = aws_iam_role.ebs_csi_driver.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonEBSCSIDriverPolicy"
}
```

- [ ] **Step 5: Add the EBS CSI add-on**

In `modules/platform_cluster/eks.tf`, add to the `addons` map after `coredns`:

```hcl
    # Created after the node group: its controller Deployment needs EC2
    # capacity for Pod Identity, and its node DaemonSet only runs on EC2.
    aws-ebs-csi-driver = {
      pod_identity_association = [{
        role_arn        = aws_iam_role.ebs_csi_driver.arn
        service_account = "ebs-csi-controller-sa"
      }]
    }
```

Append to `modules/platform_cluster/outputs.tf`:

```hcl
output "ebs_csi_driver_role_arn" {
  description = "ARN of the IAM role the EBS CSI controller assumes through EKS Pod Identity."
  value       = aws_iam_role.ebs_csi_driver.arn
}
```

- [ ] **Step 6: Run the gates**

```bash
terraform fmt -recursive
make terraform-check
```

Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add modules/platform_cluster gitops/platform/bootstrap/config-storage.yaml gitops/platform/config/storage
git commit -m "feat(platform): add the EBS CSI driver on Pod Identity and a default gp3 class"
```

---

## Task 5: KEDA with a Pod Identity operator role

**Files:**
- Modify: `modules/platform_cluster/iam_pod_identity.tf` (append)
- Modify: `modules/platform_cluster/outputs.tf` (append), `environments/platform/outputs.tf` (append)
- Create: `gitops/platform/config/addons/keda.yaml`
- Modify: `gitops/platform/config/addons/kustomization.yaml`

**Interfaces:**
- Consumes: `data.aws_iam_policy_document.pod_identity_assume_role` (Task 4).
- Produces: role `<cluster>-keda-operator` bound to `keda/keda-operator`, output `keda_operator_role_arn`. **Contract for Plan 4:** a KEDA `TriggerAuthentication` uses `podIdentity: { provider: aws, roleArn: <worker scaler role> }`. Each worker scaler role's trust policy must name `keda_operator_role_arn` as an `AWS` principal for `sts:AssumeRole` and `sts:TagSession`, and hold only `sqs:GetQueueAttributes` on its own queue.

- [ ] **Step 1: Write the failing check**

```bash
kubectl kustomize gitops/platform/config/addons | grep -c 'name: keda$'
```

Expected: `0`.

- [ ] **Step 2: Add the KEDA ApplicationSet**

`gitops/platform/config/addons/keda.yaml`:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: keda
  namespace: argocd
spec:
  # Required: the template below uses Go-template syntax ({{ .name }},
  # {{ .metadata.annotations.* }}). Without this, Argo CD falls back to legacy
  # fasttemplate, which only understands {{name}}/{{server}} and cannot
  # traverse annotations - every Application fails destination validation.
  goTemplate: true
  goTemplateOptions:
    - missingkey=error
  generators:
    - clusters:
        selector:
          matchLabels:
            platform_cluster: "true"
  template:
    metadata:
      name: '{{ .name }}-keda'
    spec:
      project: default
      source:
        repoURL: https://kedacore.github.io/charts
        chart: keda
        targetRevision: 2.21.0
        helm:
          releaseName: keda
          values: |
            # The keda namespace matches no Fargate profile, so KEDA runs on
            # the general node group - required, because its AWS credentials
            # come from EKS Pod Identity (association in Terraform:
            # modules/platform_cluster/iam_pod_identity.tf), which Fargate
            # does not support. IRSA stays off. ScaledObjects name the role to
            # assume in a TriggerAuthentication (podIdentity.provider: aws).
            podIdentity:
              aws:
                irsa:
                  enabled: false
      # KEDA rotates its own serving certificates and patches the caBundle on
      # its APIService and admission webhook at runtime. Without these
      # entries Argo CD reports them OutOfSync forever, and selfHeal writes
      # the stale bundle back, breaking the external metrics API.
      ignoreDifferences:
        - group: apiregistration.k8s.io
          kind: APIService
          jsonPointers:
            - /spec/caBundle
        - group: admissionregistration.k8s.io
          kind: ValidatingWebhookConfiguration
          jqPathExpressions:
            - .webhooks[]?.clientConfig.caBundle
      destination:
        server: '{{ .server }}'
        namespace: keda
      syncPolicy:
        automated:
          prune: true
          selfHeal: true
        syncOptions:
          # KEDA's CRDs exceed the client-side apply annotation size limit.
          - ServerSideApply=true
          - CreateNamespace=true
          - RespectIgnoreDifferences=true
```

In `gitops/platform/config/addons/kustomization.yaml`, add `  - keda.yaml` as the last entry under `resources`.

- [ ] **Step 3: Run the check and the gates**

```bash
kubectl kustomize gitops/platform/config/addons | grep -c 'name: keda$'
make yaml-check
```

Expected: `1`, then exit 0.

- [ ] **Step 4: Add the operator role and its association**

Append to `modules/platform_cluster/iam_pod_identity.tf`:

```hcl
# KEDA reads queue depth on behalf of each ScaledObject by assuming the role
# that ScaledObject's TriggerAuthentication names. This role can only assume
# other roles; what it may read is decided by each target role's trust policy,
# which must name this role's ARN.
data "aws_iam_policy_document" "keda_operator" {
  statement {
    sid       = "AssumeScalerRoles"
    effect    = "Allow"
    actions   = ["sts:AssumeRole", "sts:TagSession"]
    resources = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/*"]
  }
}

resource "aws_iam_role" "keda_operator" {
  name               = "${local.cluster_name}-keda-operator"
  assume_role_policy = data.aws_iam_policy_document.pod_identity_assume_role.json

  tags = var.tags
}

resource "aws_iam_role_policy" "keda_operator" {
  name   = "${local.cluster_name}-keda-operator"
  role   = aws_iam_role.keda_operator.id
  policy = data.aws_iam_policy_document.keda_operator.json
}

# The association may exist before the namespace or ServiceAccount does; it
# takes effect for Pods started after both exist.
resource "aws_eks_pod_identity_association" "keda_operator" {
  cluster_name    = module.eks.cluster_name
  namespace       = "keda"
  service_account = "keda-operator"
  role_arn        = aws_iam_role.keda_operator.arn

  tags = var.tags
}
```

Append to `modules/platform_cluster/outputs.tf`:

```hcl
output "keda_operator_role_arn" {
  description = "ARN of the IAM role the KEDA operator runs as. Scaler roles trust this ARN."
  value       = aws_iam_role.keda_operator.arn
}
```

Append to `environments/platform/outputs.tf`:

```hcl
output "keda_operator_role_arn" {
  description = "ARN of the IAM role the KEDA operator runs as. Scaler roles trust this ARN."
  value       = module.platform_cluster.keda_operator_role_arn
}
```

- [ ] **Step 5: Run the gates**

```bash
terraform fmt -recursive
make terraform-check
```

Expected: exit 0. If Checkov flags `data.aws_iam_policy_document.keda_operator` (for example CKV_AWS_286, privilege escalation), add as the first line of that data block:

```hcl
  #checkov:skip=CKV_AWS_286: KEDA must assume per-workload scaler roles; each target role's trust policy names this role, which is the effective boundary.
```

Use the exact ID Checkov printed. Do not skip anything else.

- [ ] **Step 6: Commit**

```bash
git add modules/platform_cluster environments/platform/outputs.tf gitops/platform/config/addons
git commit -m "feat(platform): add KEDA as an Argo CD add-on with a Pod Identity operator role"
```

---

## Task 6: The guarded `cashight` namespace

**Files:**
- Create: `gitops/platform/config/namespaces/values.yaml`
- Create: `gitops/platform/bootstrap/config-namespaces.yaml`
- Modify: `Makefile` (`helm-check`)

**Interfaces:**
- Produces: namespace `cashight` with Pod Security `restricted` (enforce, audit, warn); NetworkPolicies `tenant-ingress-deny-all`, `tenant-egress-deny-all` and `tenant-egress-allow-dns`; LimitRange `cashight-defaults`; ResourceQuota `cashight-quota`. **Contract for Plan 4:** every `cashight` Pod must satisfy Pod Security `restricted`. Workloads must bring their own allow NetworkPolicies:
  - ingress from the ALB (the VPC CIDR, on the container port);
  - egress TCP 443 to AWS APIs, Gemini and the Cognito JWKS;
  - egress to the OTLP collector (Plan 3);
  - egress to the Pod Identity agent at `169.254.170.23/32` port 80.

Quota sizing comes from spec §4.2: four API replicas, plus up to two parser workers at 1.5 GiB and one invoice worker at 2 GiB, plus canary surge. That fits inside 12 GiB of requests. The three-node pool has about 21 GiB allocatable, and roughly 6 GiB of it is reserved for Plan 3's stack.

- [ ] **Step 1: Write the failing render**

```bash
helm template namespaces gitops/platform/charts/namespace-config -f gitops/platform/config/namespaces/values.yaml
```

Expected: FAIL. `open gitops/platform/config/namespaces/values.yaml: no such file or directory`.

- [ ] **Step 2: Write the tenant values**

`gitops/platform/config/namespaces/values.yaml`:

```yaml
# Tenant namespaces on the general node group. Rendered by
# gitops/platform/charts/namespace-config through
# gitops/platform/bootstrap/config-namespaces.yaml.
#
# Names must not match apps-*: that pattern is selected by a Fargate profile,
# and these tenants need EC2 for EKS Pod Identity, EBS and NetworkPolicy.

# Prefix for the shared NetworkPolicy names (tenant-ingress-deny-all, ...).
name: tenant

networkPolicies:
  enabled: true
  egress:
    deny:
      all:
        enabled: true
        podSelector: {}
    allow:
      dns:
        enabled: true
        namespace: kube-system
        podLabels:
          k8s-app: kube-dns
        podSelector: {}
  ingress:
    deny:
      all:
        enabled: true
        podSelector: {}

namespaces:
  cashight:
    annotations:
      additionalAnnotations:
        # Removing a tenant from this file must not cascade-delete its
        # workloads. Delete the namespace by hand once it is empty.
        argocd.argoproj.io/sync-options: Prune=false
    labels:
      podSecurityAdmission:
        audit:
          standard: restricted
          version: latest
        enforce:
          standard: restricted
          version: latest
        warn:
          standard: restricted
          version: latest
    limitRanges:
      - name: cashight-defaults
        limits:
          - type: Container
            defaultRequest:
              cpu: 100m
              memory: 128Mi
            default:
              memory: 512Mi
            max:
              memory: 3Gi
    resourceQuotas:
      - name: cashight-quota
        spec:
          hard:
            requests.cpu: "3"
            requests.memory: 12Gi
            limits.memory: 16Gi
            pods: "30"
```

- [ ] **Step 3: Run the render and assert its contents**

```bash
helm template namespaces gitops/platform/charts/namespace-config -f gitops/platform/config/namespaces/values.yaml > /tmp/namespaces.yaml
kubeconform -strict -summary -ignore-missing-schemas /tmp/namespaces.yaml
for want in 'kind: Namespace' 'name: cashight$' 'pod-security.kubernetes.io/enforce: "restricted"' \
            'name: "tenant-ingress-deny-all"' 'name: "tenant-egress-deny-all"' 'name: "tenant-egress-allow-dns"' \
            'name: cashight-defaults' 'name: cashight-quota' 'argocd.argoproj.io/sync-options: Prune=false'; do
  grep -Eq "$want" /tmp/namespaces.yaml && echo "ok   $want" || echo "MISS $want"
done
```

Expected: `Valid: 6`, and every line reads `ok`. Kubeconform should count the Namespace, three NetworkPolicies, the LimitRange and the ResourceQuota.

- [ ] **Step 4: Render the real values in CI**

In `Makefile`, inside the `helm-check` target's first `if` block, add after the existing `kubeconform … /tmp/namespace-config-rendered.yaml; \` line:

```make
		helm template namespaces gitops/platform/charts/namespace-config -f gitops/platform/config/namespaces/values.yaml > /tmp/namespaces-rendered.yaml; \
		kubeconform -strict -summary -ignore-missing-schemas /tmp/namespaces-rendered.yaml; \
```

Tabs, not spaces, as in the rest of the target.

- [ ] **Step 5: Add the ApplicationSet**

`gitops/platform/bootstrap/config-namespaces.yaml`:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: platform-namespaces
  namespace: argocd
spec:
  # Required: the template below uses Go-template syntax ({{ .name }},
  # {{ .metadata.annotations.* }}). Without this, Argo CD falls back to legacy
  # fasttemplate, which only understands {{name}}/{{server}} and cannot
  # traverse annotations - every Application fails destination validation.
  goTemplate: true
  goTemplateOptions:
    - missingkey=error
  generators:
    - clusters:
        selector:
          matchLabels:
            workload_cluster: "true"
  template:
    metadata:
      name: '{{ .name }}-platform-namespaces'
    spec:
      project: default
      source:
        repoURL: '{{ .metadata.annotations.gitops_repo_url }}'
        targetRevision: '{{ .metadata.annotations.gitops_revision }}'
        path: gitops/platform/charts/namespace-config
        helm:
          releaseName: namespaces
          # Relative to the chart path; stays inside this repository.
          valueFiles:
            - ../../config/namespaces/values.yaml
      destination:
        server: '{{ .server }}'
        namespace: default
      syncPolicy:
        automated:
          prune: true
          selfHeal: true
        syncOptions:
          - ServerSideApply=true
```

- [ ] **Step 6: Run the gates**

```bash
make yaml-check
```

Expected: exit 0, and the output now includes a second `Summary: 6 resources found … Valid: 6`.

- [ ] **Step 7: Commit**

```bash
git add Makefile gitops/platform/config/namespaces gitops/platform/bootstrap/config-namespaces.yaml
git commit -m "feat(platform): add the cashight tenant namespace with default-deny policies"
```

---

## Task 7: Publish the identifiers other repos consume, and a repo-access probe

**Files:**
- Modify: `environments/platform/main.tf` (`locals`)
- Create: `environments/platform/published.tf`
- Modify: `environments/platform/outputs.tf` (append)
- Create: `scripts/check-repo-access.sh`

**Interfaces:**
- Consumes: `module.platform_cluster.cluster_name`, `module.platform_cluster.keda_operator_role_arn` (Task 5).
- Produces SSM `String` parameters under `/<resource_prefix>/platform/` (`/aws-eks-infra/platform/` by default):

  | Parameter | Value |
  |---|---|
  | `cluster-name` | `aws-eks-infra-platform` |
  | `alb-group-name` | `platform-public` |
  | `keda-operator-role-arn` | Task 5's role ARN |
  | `codeconnections-git-http-base` | `https://codeconnections.<region>.amazonaws.com/git-http/<account>/<region>/<connection-id>`; a repo URL is `<base>/<owner>/<repo>.git` |

  Plus root output `platform_parameter_prefix`, and `scripts/check-repo-access.sh <owner> <repo> <revision> <path>`, which exits 0 on access and 1 otherwise. Plan 4 reads these parameters with `data "aws_ssm_parameter"` in `cashight/terraform`.

- [ ] **Step 1: Split the CodeConnections base URL out of `gitops_repo_url`**

In `environments/platform/main.tf`, replace the `gitops_repo_url = format(…)` entry in `locals` with:

```hcl
  # Base Git-HTTP endpoint of the CodeConnections connection. Any repository
  # the connection's GitHub App installation can see is <base>/<owner>/<repo>.git.
  codeconnections_git_http_base = format(
    "https://codeconnections.%s.amazonaws.com/git-http/%s/%s/%s",
    var.aws_region,
    data.aws_caller_identity.current.account_id,
    var.aws_region,
    local.connection_id,
  )
  gitops_repo_url = "${local.codeconnections_git_http_base}/${var.github_owner}/${var.github_repository}.git"
```

The resulting `gitops_repo_url` string is unchanged, so Task 9's untargeted plan must show no change to the Argo CD cluster Secret's `gitops_repo_url` annotation.

- [ ] **Step 2: Publish the parameters**

`environments/platform/published.tf`:

```hcl
# Identifiers that workload repositories (for example Cashight's Terraform)
# read instead of hardcoding. Read-only facts about this platform; Terraform
# here does not configure the ALB - the group name is the IngressGroup that
# GitOps workloads join (docs/operations/public-workload-access.md), and the
# value below must stay identical to that annotation.
locals {
  platform_parameter_prefix = "/${var.resource_prefix}/platform"

  published_parameters = {
    "cluster-name" = {
      value       = module.platform_cluster.cluster_name
      description = "Name of the platform EKS cluster."
    }
    "alb-group-name" = {
      value       = "platform-public"
      description = "IngressGroup name of the shared internet-facing ALB."
    }
    "keda-operator-role-arn" = {
      value       = module.platform_cluster.keda_operator_role_arn
      description = "IAM role the KEDA operator runs as; scaler roles must trust it."
    }
    "codeconnections-git-http-base" = {
      value       = local.codeconnections_git_http_base
      description = "CodeConnections Git-HTTP base; a repository URL is <base>/<owner>/<repo>.git."
    }
  }
}

resource "aws_ssm_parameter" "published" {
  #checkov:skip=CKV2_AWS_34: Non-secret identifiers published for other repositories; SecureString would add KMS calls and nothing else.
  for_each = local.published_parameters

  name        = "${local.platform_parameter_prefix}/${each.key}"
  description = each.value.description
  type        = "String"
  value       = each.value.value

  tags = local.tags
}
```

Append to `environments/platform/outputs.tf`:

```hcl
output "platform_parameter_prefix" {
  description = "SSM parameter path under which the platform publishes identifiers for workload repositories."
  value       = local.platform_parameter_prefix
}
```

- [ ] **Step 3: Run the Terraform gates**

```bash
terraform fmt -recursive
make terraform-check
```

Expected: exit 0.

- [ ] **Step 4: Write the probe script**

`scripts/check-repo-access.sh`:

```bash
#!/usr/bin/env bash
# Prove managed Argo CD can read a repository through the platform's
# CodeConnections connection, without deploying anything from it.
#
# Usage: scripts/check-repo-access.sh <owner> <repo> <revision> <path>
#
# Creates a throwaway Application with no sync policy, waits for Argo CD to
# compare it, and prints PASS or FAIL. Nothing is ever synced from the
# repository; the Application is deleted on exit. Pick a <path> that holds no
# Kubernetes manifests (a docs directory) so the comparison has nothing to
# render. Exits 0 on PASS, 1 on FAIL, 2 on usage errors.
set -euo pipefail

if [ "$#" -ne 4 ]; then
  echo "usage: $0 <owner> <repo> <revision> <path>" >&2
  exit 2
fi
owner="$1"
repo="$2"
revision="$3"
path="$4"

region="${AWS_REGION:-$(aws configure get region)}"
prefix="$(terraform -chdir=environments/platform output -raw platform_parameter_prefix)"
base="$(aws ssm get-parameter --name "${prefix}/codeconnections-git-http-base" --region "$region" --query 'Parameter.Value' --output text)"
cluster_arn="$(terraform -chdir=environments/platform output -raw cluster_arn)"
name="repo-access-check-$(date +%s)"

trap 'kubectl -n argocd delete application "$name" --ignore-not-found --wait=false >/dev/null' EXIT

kubectl apply -f - >/dev/null <<EOF
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: ${name}
  namespace: argocd
spec:
  project: default
  source:
    repoURL: ${base}/${owner}/${repo}.git
    targetRevision: ${revision}
    path: ${path}
  destination:
    server: ${cluster_arn}
    namespace: default
EOF

for _ in $(seq 1 30); do
  app="$(kubectl -n argocd get application "$name" -o json)"
  errors="$(jq -r '[.status.conditions[]? | select(.type | endswith("Error")) | .message] | join("; ")' <<<"$app")"
  resolved="$(jq -r '.status.sync.revision // empty' <<<"$app")"
  if [ -n "$errors" ]; then
    echo "FAIL ${owner}/${repo}@${revision}: ${errors}"
    exit 1
  fi
  if [ -n "$resolved" ]; then
    echo "PASS ${owner}/${repo}@${revision} resolved to ${resolved}"
    exit 0
  fi
  sleep 10
done

echo "FAIL ${owner}/${repo}@${revision}: Argo CD did not compare the Application within 5 minutes"
exit 1
```

```bash
chmod +x scripts/check-repo-access.sh
```

- [ ] **Step 5: Check the usage path and run shellcheck**

```bash
./scripts/check-repo-access.sh; echo "exit=$?"
make shell-check
```

Expected: `usage: ./scripts/check-repo-access.sh <owner> <repo> <revision> <path>`, `exit=2`, then shellcheck exits 0.

- [ ] **Step 6: Commit**

```bash
git add environments/platform scripts/check-repo-access.sh
git commit -m "feat(platform): publish cluster identifiers to SSM and add a repo-access probe"
```

---

## Task 8: Acceptance script and documentation for mixed Fargate/EC2 capacity

**Files:**
- Modify: `scripts/verify-platform.sh` (full replacement below)
- Modify: `CLAUDE.md`, `AGENTS.md`, `README.md`, `docs/operations/deploy-platform.md`, `docs/operations/cluster-access.md`, `docs/operations/validate-platform.md`, `docs/operations/github-connection.md`, `gitops/workloads/README.md`

**Interfaces:**
- Consumes: node group `<cluster>-general` (Task 3), add-on names (Tasks 3–4), Deployments `kube-system/ebs-csi-controller`, `keda/keda-operator`, `keda/keda-operator-metrics-apiserver`, `keda/keda-admission-webhooks` (Tasks 4–5), the tenant policy names (Task 6), the parameters and the `platform_parameter_prefix` output (Task 7).
- Produces: `verify-platform.sh` with environment inputs `EXPECTED_NODES` (default `3`), `WORKLOAD_NAMESPACES` (default `cashight`, space-separated), `PARAMETER_PREFIX` (default from the Terraform output), plus the existing `EXPECT_WORKLOADS`, `CLUSTER_NAME` and `AWS_REGION`.

- [ ] **Step 1: Replace `scripts/verify-platform.sh`**

```bash
#!/usr/bin/env bash
# Platform acceptance. See docs/operations/validate-platform.md.
#
# Two groups of assertions:
#
#   Platform invariants  always checked. Capacity (Fargate profiles and the
#                        general EC2 node group), add-ons, capabilities ACTIVE,
#                        controllers rolled out, Applications converged, tenant
#                        namespaces guarded, identifiers published.
#   Greenfield non-goals only meaningful before any workload is deployed - no
#                        workload Pods, no Ingress, no LoadBalancer Service.
#
# Set EXPECT_WORKLOADS=true once the platform hosts workloads; the non-goal
# assertions are then replaced by checks that workloads stay inside their
# namespace contract. EXPECTED_NODES is the node group size (default 3), and
# WORKLOAD_NAMESPACES lists the tenant namespaces declared in
# gitops/platform/config/namespaces/values.yaml (default "cashight").
set -euo pipefail

cluster="${CLUSTER_NAME:-$(terraform -chdir=environments/platform output -raw cluster_name)}"
region="${AWS_REGION:-$(aws configure get region)}"
parameter_prefix="${PARAMETER_PREFIX:-$(terraform -chdir=environments/platform output -raw platform_parameter_prefix)}"
EXPECT_WORKLOADS="${EXPECT_WORKLOADS:-false}"
EXPECTED_NODES="${EXPECTED_NODES:-3}"
read -r -a workload_namespaces <<<"${WORKLOAD_NAMESPACES:-cashight}"
nodegroup="${cluster}-general"

fail=0
pass() { echo "PASS $1"; }
fail_line() {
  echo "FAIL $1"
  fail=1
}
assert_eq() {
  if [ "$2" = "$3" ]; then pass "$1"; else fail_line "$1 (got '$2', want '$3')"; fi
}
# $2 is a newline-separated list that must be empty; offenders are named.
assert_empty() {
  if [ -z "$2" ]; then pass "$1"; else fail_line "$1 ($(echo "$2" | tr '\n' ' '))"; fi
}

# ---------------------------------------------------------------- platform ---

connection="$(terraform -chdir=environments/platform output -raw github_connection_arn)"
assert_eq "CodeConnections AVAILABLE" "$(aws codeconnections get-connection --connection-arn "$connection" --query 'Connection.ConnectionStatus' --output text)" AVAILABLE
assert_eq "EKS ACTIVE" "$(aws eks describe-cluster --name "$cluster" --region "$region" --query 'cluster.status' --output text)" ACTIVE
if aws eks list-fargate-profiles --cluster-name "$cluster" --region "$region" --query 'fargateProfileNames[]' --output text | xargs -n1 -I{} aws eks describe-fargate-profile --cluster-name "$cluster" --fargate-profile-name {} --region "$region" --query 'fargateProfile.status' --output text | grep -qv '^ACTIVE$'; then fail_line "Fargate profiles ACTIVE"; else pass "Fargate profiles ACTIVE"; fi

# --- EC2 capacity. Fargate nodes come and go with their Pods; EC2 nodes are
# exactly the general node group, Graviton, one per AZ.
assert_eq "Node group ${nodegroup} ACTIVE" "$(aws eks describe-nodegroup --cluster-name "$cluster" --nodegroup-name "$nodegroup" --region "$region" --query 'nodegroup.status' --output text)" ACTIVE
ec2_nodes="$(kubectl get nodes -o json | jq '[.items[] | select(.metadata.labels["eks.amazonaws.com/compute-type"] != "fargate")]')"
assert_eq "EC2 nodes Ready" "$(jq '[.[] | select(any(.status.conditions[]; .type == "Ready" and .status == "True"))] | length' <<<"$ec2_nodes")" "$EXPECTED_NODES"
expected_zones=$((EXPECTED_NODES < 3 ? EXPECTED_NODES : 3))
assert_eq "EC2 nodes span ${expected_zones} AZs" "$(jq '[.[].metadata.labels["topology.kubernetes.io/zone"]] | unique | length' <<<"$ec2_nodes")" "$expected_zones"
assert_empty "EC2 nodes are arm64 members of ${nodegroup}" "$(jq -r --arg ng "$nodegroup" '.[] | select(.metadata.labels["kubernetes.io/arch"] != "arm64" or .metadata.labels["eks.amazonaws.com/nodegroup"] != $ng) | .metadata.name' <<<"$ec2_nodes")"

# --- Add-ons. Without enableNetworkPolicy the VPC CNI accepts NetworkPolicy
# objects and silently enforces none of them.
for addon in vpc-cni kube-proxy eks-pod-identity-agent coredns aws-ebs-csi-driver; do
  assert_eq "Add-on ${addon} ACTIVE" "$(aws eks describe-addon --cluster-name "$cluster" --addon-name "$addon" --region "$region" --query 'addon.status' --output text)" ACTIVE
done
assert_eq "VPC CNI enforces NetworkPolicy" "$(aws eks describe-addon --cluster-name "$cluster" --addon-name vpc-cni --region "$region" --query 'addon.configurationValues' --output text | jq -r '.enableNetworkPolicy // "unset"')" true

for capability in argocd ack kro; do assert_eq "${capability} capability ACTIVE" "$(aws eks describe-capability --cluster-name "$cluster" --capability-name "${cluster}-${capability}" --region "$region" --query 'capability.status' --output text)" ACTIVE; done
for deployment in 'kube-system coredns' 'kube-system aws-load-balancer-controller' 'kube-system ebs-csi-controller' 'argo-rollouts argo-rollouts' 'cert-manager cert-manager' 'cert-manager cert-manager-webhook' 'opentelemetry-operator-system opentelemetry-operator' 'keda keda-operator' 'keda keda-operator-metrics-apiserver' 'keda keda-admission-webhooks'; do
  read -r ns name <<<"$deployment"
  if kubectl -n "$ns" rollout status deployment/"$name" --timeout=5m >/dev/null; then
    pass "Deployment $ns/$name"
  else
    fail_line "Deployment $ns/$name"
  fi
done

# Pod Identity does not work on Fargate. These Pods must be on EC2 nodes, or
# they start without AWS credentials.
misplaced="$(
  kubectl get pods -A -o json |
    jq -r '
      .items[]
      | select(.metadata.namespace == "keda" or (.metadata.namespace == "kube-system" and (.metadata.labels.app // "") == "ebs-csi-controller"))
      | select((.spec.nodeName // "") | startswith("fargate-"))
      | "\(.metadata.namespace)/\(.metadata.name)"
    '
)"
assert_empty "Pod Identity consumers run on EC2" "$misplaced"

assert_eq "KEDA external metrics APIService Available" "$(kubectl get apiservice v1beta1.external.metrics.k8s.io -o jsonpath='{.status.conditions[?(@.type=="Available")].status}')" True
assert_eq "Default StorageClass is gp3" "$(kubectl get storageclass -o json | jq -r '[.items[] | select(.metadata.annotations["storageclass.kubernetes.io/is-default-class"] == "true") | .metadata.name] | join(",")')" gp3

# `all` on an empty array is vacuously true, so an empty argocd namespace used to
# pass this. Require at least one Application as well.
apps_json="$(kubectl -n argocd get applications -o json)"
app_count="$(printf '%s' "$apps_json" | jq '.items | length')"
if [ "$app_count" = 0 ]; then
  fail_line "Argo Applications Synced Healthy (none exist)"
elif printf '%s' "$apps_json" | jq -e '.items | all(.status.sync.status == "Synced" and .status.health.status == "Healthy")' >/dev/null; then
  pass "Argo Applications Synced Healthy ($app_count)"
else
  fail_line "Argo Applications Synced Healthy"
  printf '%s' "$apps_json" | jq -r '
    .items[]
    | select((.status.sync.status != "Synced") or (.status.health.status != "Healthy"))
    | "    \(.metadata.name): \(.status.sync.status // "?")/\(.status.health.status // "?")"
  '
fi

# --- Tenant namespaces: restricted Pod Security, default-deny, a quota.
for ns in "${workload_namespaces[@]}"; do
  assert_eq "Namespace ${ns} enforces restricted Pod Security" "$(kubectl get namespace "$ns" -o jsonpath='{.metadata.labels.pod-security\.kubernetes\.io/enforce}' 2>/dev/null || true)" restricted
  policies=" $(kubectl -n "$ns" get networkpolicy -o jsonpath='{.items[*].metadata.name}' 2>/dev/null || true) "
  for policy in tenant-ingress-deny-all tenant-egress-deny-all tenant-egress-allow-dns; do
    if [[ "$policies" == *" ${policy} "* ]]; then pass "NetworkPolicy ${ns}/${policy}"; else fail_line "NetworkPolicy ${ns}/${policy}"; fi
  done
  assert_eq "ResourceQuota in ${ns}" "$(kubectl -n "$ns" get resourcequota -o json 2>/dev/null | jq '.items | length')" 1
done

# --- Identifiers published for workload repositories.
for parameter in cluster-name alb-group-name keda-operator-role-arn codeconnections-git-http-base; do
  value="$(aws ssm get-parameter --name "${parameter_prefix}/${parameter}" --region "$region" --query 'Parameter.Value' --output text 2>/dev/null || true)"
  if [ -n "$value" ] && [ "$value" != None ]; then pass "SSM ${parameter_prefix}/${parameter}"; else fail_line "SSM ${parameter_prefix}/${parameter}"; fi
done
assert_eq "Published cluster-name matches" "$(aws ssm get-parameter --name "${parameter_prefix}/cluster-name" --region "$region" --query 'Parameter.Value' --output text 2>/dev/null || true)" "$cluster"

# --------------------------------------------------------------- workloads ---

# Namespaces the platform itself runs in.
platform_namespaces='^(kube-system|argo-rollouts|cert-manager|opentelemetry-operator-system|amazon-cloudwatch|keda|argocd|kube-public|kube-node-lease|default)$'
tenants_json="$(printf '%s\n' "${workload_namespaces[@]}" | jq -R . | jq -s .)"
# A workload Pod lives in an apps-* namespace (Fargate) or a tenant namespace (EC2).
workload_filter='(.metadata.namespace | startswith("apps-")) or (.metadata.namespace as $ns | $tenants | index($ns) != null)'

if [ "$EXPECT_WORKLOADS" = true ]; then
  # Workloads are allowed. Assert they respect the namespace contract and are
  # actually running, rather than asserting they do not exist.
  stray="$(
    kubectl get pods -A -o json |
      jq -r --arg re "$platform_namespaces" --argjson tenants "$tenants_json" "
        .items[]
        | select((.metadata.namespace | test(\$re)) | not)
        | select(($workload_filter) | not)
        | \"\(.metadata.namespace)/\(.metadata.name)\"
      "
  )"
  assert_empty "Workload Pods confined to apps-* and tenant namespaces" "$stray"

  unhealthy="$(
    kubectl get pods -A -o json |
      jq -r --argjson tenants "$tenants_json" "
        .items[]
        | select($workload_filter)
        | select(.status.phase != \"Running\" and .status.phase != \"Succeeded\")
        | \"\(.metadata.namespace)/\(.metadata.name) \(.status.phase)\"
      "
  )"
  assert_empty "Workload Pods Running" "$unhealthy"

  # Every Ingress must have been reconciled into a load balancer address.
  pending="$(
    kubectl get ingress -A -o json |
      jq -r '.items[] | select((.status.loadBalancer.ingress // []) | length == 0) | "\(.metadata.namespace)/\(.metadata.name)"'
  )"
  assert_empty "Ingresses have load balancer addresses" "$pending"
else
  # Greenfield non-goals: nothing is hosted yet.
  assert_eq "No service workloads" "$(kubectl get pods -A -o json | jq --argjson tenants "$tenants_json" "[.items[] | select($workload_filter)] | length")" 0
  assert_eq "No Ingress" "$(kubectl get ingress -A -o json | jq '.items | length')" 0
  assert_eq "No LoadBalancer Service" "$(kubectl get svc -A -o json | jq '[.items[] | select(.spec.type == "LoadBalancer")] | length')" 0
fi

exit "$fail"
```

- [ ] **Step 2: Run shellcheck and a syntax-only check**

```bash
make shell-check
bash -n scripts/verify-platform.sh && echo syntax-ok
```

Expected: exit 0 and `syntax-ok`. The jq programs in double quotes interpolate `$workload_filter` on purpose and escape every jq `$` and `"`. If shellcheck reports SC2016 on a single-quoted jq program, that is a false positive. Rewrite that program in the double-quoted form rather than adding a disable comment.

- [ ] **Step 3: Check the jq filters against a fixture (no cluster needed)**

```bash
tenants='["cashight"]'
filter='(.metadata.namespace | startswith("apps-")) or (.metadata.namespace as $ns | $tenants | index($ns) != null)'
jq -c --argjson tenants "$tenants" "[.items[] | select($filter) | .metadata.namespace]" <<'EOF'
{"items":[{"metadata":{"namespace":"cashight"}},{"metadata":{"namespace":"apps-jenkins"}},{"metadata":{"namespace":"keda"}},{"metadata":{"namespace":"cashight-old"}}]}
EOF
```

Expected: `["cashight","apps-jenkins"]`. `cashight-old` must not match, so this is a whole-name match, not a prefix match.

- [ ] **Step 4: Replace the Fargate-only statements in the docs**

`CLAUDE.md` line 7 becomes:

```markdown
Terraform + GitOps blueprint for a single Amazon EKS platform (`environments/platform`). Platform add-ons run on **AWS Fargate**; workloads that need EBS volumes, DaemonSets or EKS Pod Identity run on one fixed-size **EKS managed node group** of Graviton instances (`<cluster>-general`, three `t4g.large` by default). No Auto Mode, no Karpenter. Platform controllers come from AWS-managed *EKS Capabilities* (Argo CD, ACK, kro) rather than Helm installs.
```

In `CLAUDE.md`, the `verify-platform.sh` comment in the Commands block becomes `# acceptance: capabilities ACTIVE, node group + add-ons, Apps Synced/Healthy`. Replace the "Fargate namespace contract" section body with:

```markdown
Fargate profiles in `modules/platform_cluster/eks.tf` select: CoreDNS and the AWS Load Balancer Controller in `kube-system` (by label, not the whole namespace), `argo-rollouts`, `cert-manager`, `opentelemetry-operator-system`, `amazon-cloudwatch`, and `apps-*`. Every other Pod lands on the general node group. Two rules follow:

- A Pod using EKS Pod Identity, an EBS volume, or a DaemonSet must **not** match a Fargate selector. Pod Identity and DaemonSets do not work on Fargate.
- Tenant namespaces that need EC2 (for example `cashight`) are declared in `gitops/platform/config/namespaces/values.yaml` and must not match `apps-*`.

Adding a Fargate platform component still means adding its namespace to a profile selector *and* to the GitOps config in the same change. Fargate Pods carry the cluster primary security group and node-group Pods the node security group; `compute_ec2.tf` opens the two to each other.
```

Add one paragraph after the "Public access contract" section:

```markdown
### Published identifiers

`environments/platform/published.tf` writes non-secret identifiers to SSM under `/<resource_prefix>/platform/`: `cluster-name`, `alb-group-name`, `keda-operator-role-arn` and `codeconnections-git-http-base`. Workload repositories read these instead of hardcoding them. `alb-group-name` restates the GitOps IngressGroup name; Terraform still does not configure the ALB.
```

`AGENTS.md` line 5 becomes: `This repository manages one EKS platform: Fargate for platform add-ons plus one Graviton managed node group for workloads. Keep application deployments and architecture improvements in separate plans.`

`README.md`: the subtitle (line 5) becomes `**Terraform and GitOps blueprint for an Amazon EKS platform: Fargate for platform add-ons, a Graviton node group for workloads.**`. In the Overview list, replace `- Amazon EKS with no EC2 node groups, Auto Mode, or Karpenter.` with these three bullets:

```markdown
- Amazon EKS with Fargate for platform add-ons and one fixed-size Graviton managed node group (three `t4g.large` by default); no Auto Mode or Karpenter.
- EBS CSI driver with a default encrypted `gp3` StorageClass, EKS Pod Identity, and NetworkPolicy enforcement in the VPC CNI.
- KEDA for event-driven Pod scaling, and guarded tenant namespaces from the `namespace-config` chart.
```

`docs/operations/deploy-platform.md`:
- Line 3: replace `Fargate-only` with `Fargate-plus-node-group`.
- Stage 3: add `-target=aws_budgets_budget.account_monthly` as the first target of the targeted apply. Then add: `The budget is account-wide and alerts by email at 50/80/100% of actual and 100% of forecast spend. Applying it first means the alarm exists before the cluster costs anything.`
- Stage 3's handshake sentence: replace `restricting the GitHub App installation to the single GitOps repository` with `restricting the GitHub App installation to the GitOps repository and any workload repository Argo CD must read (for Cashight: \`cashight\`)`.
- Stage 4's resource description: add `one managed node group (three Graviton nodes), the VPC CNI, kube-proxy, Pod Identity Agent and EBS CSI add-ons, two Pod Identity roles and associations, two security-group rules`.
- Replace the Stage 4 gate block `Gate — no EC2 compute anywhere:` and its commands with:

````markdown
Gate — the node group is up, one node per AZ:

```bash
cluster="$(terraform -chdir=environments/platform output -raw cluster_name)"
aws eks describe-nodegroup --cluster-name "$cluster" --nodegroup-name "${cluster}-general" --query 'nodegroup.status' --output text   # expect ACTIVE
kubectl get nodes -L eks.amazonaws.com/compute-type,topology.kubernetes.io/zone,kubernetes.io/arch                                    # expect 3 arm64 EC2 nodes in 3 zones, plus fargate-ip-* nodes
aws eks list-fargate-profiles --cluster-name "$cluster" --output text                                                                  # expect 3
```
````

- Stage 7: replace `the root plus four child ApplicationSets` with `the root plus six child ApplicationSets (addons, observability, kro-definitions, workloads, storage, namespaces)`. Replace the paragraph starting `Expected: every node reports` with `Expected: Fargate nodes host kube-system's CoreDNS and load balancer controller, argo-rollouts, cert-manager, opentelemetry-operator-system and amazon-cloudwatch. Everything else, including keda and kube-system's DaemonSets and EBS CSI controller, runs on the three EC2 nodes.`
- Stage 8: replace the `Confirm the plan's non-goals still hold: …` sentence with `Run \`EXPECT_WORKLOADS=true ./scripts/verify-platform.sh\` once workloads such as Jenkins are deployed.`

`docs/operations/cluster-access.md`: replace the paragraph starting `The node group list must be empty.` with `The node group list must contain \`<cluster>-general\`. The Fargate profile list must contain the system, platform-addons, and future-workloads profiles. CoreDNS must become available on Fargate. \`kubectl get nodes\` shows three EC2 nodes (one per zone) plus Fargate nodes created on demand for Fargate Pods.` In the "Namespace contract" section, replace the last sentence (`Do not create managed node groups …`) with `Every other namespace schedules onto the general node group; see the Fargate namespace contract in CLAUDE.md.`

`docs/operations/validate-platform.md`: replace the bullet `` - `aws eks list-nodegroups` empty, **and** every node labelled … `` (through `catch self-managed EC2 capacity`) with:

```markdown
- Node group `<cluster>-general` `ACTIVE`, `EXPECTED_NODES` (default 3) Ready
  arm64 EC2 nodes, all from that node group, across `min(EXPECTED_NODES, 3)`
  zones
- Add-ons `vpc-cni` (with `enableNetworkPolicy`), `kube-proxy`,
  `eks-pod-identity-agent`, `coredns`, `aws-ebs-csi-driver` `ACTIVE`
- KEDA rolled out, its external metrics APIService `Available`, and every
  `keda` and EBS CSI controller Pod on EC2 (Pod Identity does not work on
  Fargate)
- Default StorageClass `gp3`
- Each `WORKLOAD_NAMESPACES` namespace (default `cashight`) enforces Pod
  Security `restricted` and has the three default NetworkPolicies and a quota
- The four SSM parameters under `PARAMETER_PREFIX` exist
```

`docs/operations/github-connection.md`: replace `Restrict the GitHub App installation to the single GitOps repository, \`<github_owner>/<github_repository>\`.` with `Restrict the GitHub App installation to the GitOps repository, \`<github_owner>/<github_repository>\`, plus each workload repository Argo CD must read. The connection's ARN is the only thing the Argo CD capability role can use, so the installation's repository list is the access boundary. After adding a repository, prove access with \`./scripts/check-repo-access.sh <owner> <repo> <revision> <docs-path>\`.`

`gitops/workloads/README.md`: replace the "Contract" paragraph with:

```markdown
Workloads either use `apps-*` namespaces (Fargate capacity, Fargate-compatible
security contexts, ALB IP targets — Jenkins in `apps-jenkins` is the example,
see `docs/operations/deploy-jenkins.md`), or a tenant namespace declared in
`gitops/platform/config/namespaces/values.yaml` (EC2 capacity, Pod Security
`restricted`, default-deny NetworkPolicies the workload must open itself).
```

- [ ] **Step 5: Run every gate**

```bash
make terraform-check && make yaml-check && make shell-check
```

Expected: all three exit 0.

- [ ] **Step 6: Commit**

```bash
git add scripts/verify-platform.sh CLAUDE.md AGENTS.md README.md docs/operations gitops/workloads/README.md
git commit -m "feat(platform): accept and document mixed Fargate and EC2 capacity"
```

---

## Task 9: Deploy the platform and accept it (phase 1 exit criterion)

**Repo:** `aws-eks-infra`, workstation. **This task starts billing**: about $11/day once Stage 4 completes (spec §6). The spec's go/no-go point is after Plan 3. If the platform must come down before then, use `./scripts/destroy-platform.sh "destroy platform"`.

**Files:**
- Modify (local, gitignored): `environments/platform/terraform.tfvars`, `environments/platform/backend.hcl`, `bootstrap/terraform-state/*` local config as `docs/operations/terraform-state.md` describes

**Interfaces:**
- Consumes: everything from Tasks 2–8 on the pushed branch `feat/ec2-capacity-keda`.
- Produces: a running platform with `verify-platform.sh` all `PASS`. The PR is merged into `main`, and Argo CD reconciles `main`.

Follow `docs/operations/deploy-platform.md` as updated in Task 8. The steps below add the inputs and checks specific to this deployment. Bridge credentials first in every new shell: `eval "$(aws configure export-credentials --format env)"`, then `export AWS_REGION=ap-southeast-1`.

- [ ] **Step 1: Push the branch and open the PR (Argo CD reads the branch, not the working tree)**

```bash
git push -u origin feat/ec2-capacity-keda
gh pr create --base main --title "feat(platform): EC2 node group, Pod Identity, EBS CSI, KEDA and the cashight namespace" \
  --body "Phase 1 of the Cashight EKS migration. Validation: make terraform-check; make yaml-check; make shell-check. Live acceptance results are posted below before merge."
gh pr checks --watch
```

Expected: `terraform-ci`, `yaml-ci` and `shell-ci` pass.

- [ ] **Step 2: Stage 1 prerequisites and Identity Center (phase 0 item)**

```bash
./scripts/verify-prerequisites.sh
aws identitystore list-users \
  --identity-store-id "$(aws sso-admin list-instances --query 'Instances[0].IdentityStoreId' --output text)" \
  --query 'Users[].{id:UserId,name:UserName}' --output table
```

Expected: the script exits 0, and the table lists the operator. Confirm that user's `id` is the one in `argocd_admin_user_ids` in the local tfvars.

- [ ] **Step 3: Bring the local tfvars up to date**

`environments/platform/terraform.tfvars` must contain:

```hcl
github_owner               = "HuyNguyen260398"
github_repository          = "aws-eks-infra"
public_access_cidrs        = ["<output of: curl -s https://checkip.amazonaws.com>/32"]
argocd_admin_user_ids      = ["<id from Step 2>"]
budget_notification_emails = ["huynguyen260398@gmail.com"]

# Local-only: Argo CD tracks the feature branch until the PR merges (Step 14).
gitops_revision = "feat/ec2-capacity-keda"
```

Remove the stale `gitops_revision = "feat/generic-public-workload-access"` line.

- [ ] **Step 4: Stage 2, the state foundation (the bucket is gone)**

Follow `docs/operations/terraform-state.md` exactly: apply `bootstrap/terraform-state` with local state, then `init -migrate-state`. Gate:

```bash
terraform -chdir=bootstrap/terraform-state plan -detailed-exitcode; echo "exit=$?"
```

Expected: `exit=0`. Then make sure `environments/platform/backend.hcl` names the recreated bucket and KMS key from that root's outputs.

- [ ] **Step 5: Stage 3, the budget first, then Identity Center and CodeConnections**

```bash
terraform -chdir=environments/platform init -reconfigure -backend-config=backend.hcl
terraform -chdir=environments/platform apply \
  -target=aws_budgets_budget.account_monthly \
  -target=aws_identitystore_group.argocd_admins \
  -target=aws_identitystore_group_membership.argocd_admins \
  -target=aws_codeconnections_connection.github
aws budgets describe-budget --account-id 010382427026 --budget-name aws-eks-infra-account-monthly \
  --query 'Budget.[BudgetName,BudgetLimit.Amount]' --output text
```

Expected: `aws-eks-infra-account-monthly 400.0`. This closes phase 0's "set an AWS budget alarm".

Complete the CodeConnections handshake in the console (**Developer Tools → Settings → Connections → aws-eks-infra-github → Update pending connection**). In the GitHub App step, grant the installation **both** `HuyNguyen260398/aws-eks-infra` and `HuyNguyen260398/cashight`. If an existing AWS Connector installation is offered, select it and add `cashight` to its repository list. Gate:

```bash
aws codeconnections get-connection \
  --connection-arn "$(terraform -chdir=environments/platform output -raw github_connection_arn)" \
  --query 'Connection.ConnectionStatus' --output text
```

Expected: `AVAILABLE`.

- [ ] **Step 6: Stage 4, the cluster and the node group**

```bash
terraform -chdir=environments/platform plan -target=module.platform_cluster -out=tfplan
terraform -chdir=environments/platform show -no-color tfplan | grep -E '^  # .* will be created' | sed -E 's/^  # //; s/ will be created//' | sort > /tmp/stage4.txt
grep -cE 'eks_managed_node_group|aws_eks_addon|pod_identity|ebs_csi|keda_operator|fargate_from_nodes|nodes_from_fargate' /tmp/stage4.txt
```

Review the plan. Beyond the runbook's roughly 80 resources, it must create:
- the `general` managed node group with its launch template and IAM role `aws-eks-infra-platform-node`;
- five `aws_eks_addon` resources (`vpc-cni`, `kube-proxy`, `eks-pod-identity-agent`, `coredns`, `aws-ebs-csi-driver`);
- `aws_eks_pod_identity_association` resources for the EBS CSI controller (through the add-on) and the KEDA operator;
- roles `aws-eks-infra-platform-ebs-csi-driver` and `aws-eks-infra-platform-keda-operator`;
- the two `aws_vpc_security_group_ingress_rule` resources.

Then:

```bash
terraform -chdir=environments/platform apply tfplan
aws eks update-kubeconfig --name aws-eks-infra-platform --region ap-southeast-1
```

Apply the runbook's conditional CoreDNS restart only if its symptoms appear. Then run the updated Stage 4 gate from `deploy-platform.md`.

Expected: node group `ACTIVE`, and `kubectl get nodes -L eks.amazonaws.com/compute-type,topology.kubernetes.io/zone,kubernetes.io/arch` shows three `arm64` nodes in `ap-southeast-1a`, `-1b` and `-1c`.

- [ ] **Step 7: Stage 5, capability readiness**

Follow the runbook. All three capabilities must be `ACTIVE`.

- [ ] **Step 8: Stage 6, the untargeted apply**

```bash
terraform -chdir=environments/platform plan -out=tfplan
terraform -chdir=environments/platform show -no-color tfplan | grep -E '^  # ' 
```

Expected: only these are created: `module.platform_cluster_bootstrap` (the cluster Secret and the `platform-bootstrap` ApplicationSet), plus four `aws_ssm_parameter.published[...]`. **There are no changes to `module.platform_cluster`.** Apply:

```bash
terraform -chdir=environments/platform apply tfplan
kubectl -n argocd get secret platform-cluster -o jsonpath='{.metadata.annotations.gitops_repo_url}'; echo
```

Expected: the URL ends in `/HuyNguyen260398/aws-eks-infra.git`. That confirms Task 7's refactor kept the value.

- [ ] **Step 9: Stage 7, GitOps sync**

```bash
kubectl -n argocd get applicationsets
kubectl -n argocd get applications -o wide
```

Expected: `platform-bootstrap` plus `platform-addons`, `platform-observability`, `platform-kro-definitions`, `platform-workloads`, `platform-workload-charts`, `platform-storage` and `platform-namespaces`. The Applications include `…-keda`, `…-platform-storage` and `…-platform-namespaces`, and all reach `Synced`/`Healthy`. Use the runbook's "Application not Synced / Healthy" recovery for any that do not.

- [ ] **Step 10: Stage 8, acceptance**

```bash
EXPECT_WORKLOADS=true ./scripts/verify-platform.sh | tee /tmp/verify-platform.txt
./scripts/check-drift.sh
```

`EXPECT_WORKLOADS=true` is used because the default `config/charts` deploys Jenkins into `apps-jenkins`. Expected: every line is `PASS`, the script exits 0, and drift is exit code 0 for both roots.

- [ ] **Step 11: Live tests for Review Focus items 1–3**

DNS from an EC2 Pod. The `default` namespace matches no Fargate profile, so this Pod lands on a node:

```bash
kubectl run dns-smoke --image=public.ecr.aws/docker/library/busybox:1.37 --restart=Never --rm -i --quiet -- \
  nslookup kubernetes.default.svc.cluster.local
```

Expected: an `Address:` line with the cluster service IP. A timeout means the Task 3 security-group rules are missing.

NetworkPolicy enforcement in `cashight`. The Pod must satisfy Pod Security `restricted`, and it carries no resource requests on purpose, so this also proves the LimitRange defaults satisfy the quota:

```bash
kubectl -n cashight run netpol-smoke --image=public.ecr.aws/docker/library/busybox:1.37 --restart=Never --rm -i --quiet \
  --overrides='{"apiVersion":"v1","spec":{"securityContext":{"runAsNonRoot":true,"runAsUser":65534,"seccompProfile":{"type":"RuntimeDefault"}},"containers":[{"name":"netpol-smoke","image":"public.ecr.aws/docker/library/busybox:1.37","command":["sh","-c","nslookup aws.amazon.com >/dev/null && echo dns-ok; wget -q -T 5 -O /dev/null http://aws.amazon.com && echo egress-OPEN || echo egress-blocked"],"securityContext":{"allowPrivilegeEscalation":false,"capabilities":{"drop":["ALL"]}}}]}}'
```

Expected: `dns-ok` then `egress-blocked`. `egress-OPEN` means NetworkPolicy is not enforced. Check `enableNetworkPolicy` on the `vpc-cni` add-on, and that the Pod is not on a `fargate-*` node.

An EBS volume binds through Pod Identity:

```bash
kubectl apply -f - <<'EOF'
apiVersion: v1
kind: PersistentVolumeClaim
metadata: { name: ebs-smoke, namespace: default }
spec:
  accessModes: [ReadWriteOnce]
  resources: { requests: { storage: 1Gi } }
---
apiVersion: v1
kind: Pod
metadata: { name: ebs-smoke, namespace: default }
spec:
  containers:
    - name: c
      image: public.ecr.aws/docker/library/busybox:1.37
      command: ["sh", "-c", "echo ok > /data/probe && cat /data/probe && sleep 5"]
      volumeMounts: [{ name: d, mountPath: /data }]
  restartPolicy: Never
  volumes: [{ name: d, persistentVolumeClaim: { claimName: ebs-smoke } }]
EOF
kubectl wait --for=jsonpath='{.status.phase}'=Bound pvc/ebs-smoke --timeout=3m
kubectl wait --for=jsonpath='{.status.phase}'=Succeeded pod/ebs-smoke --timeout=3m
kubectl logs ebs-smoke
kubectl delete pod/ebs-smoke pvc/ebs-smoke
```

Expected: `Bound`, `Succeeded` and `ok`. The PVC names no class, so this also proves `gp3` is the default.

- [ ] **Step 12: Live test for Review Focus item 5, Argo CD reads `cashight`**

```bash
./scripts/check-repo-access.sh HuyNguyen260398 cashight cashight-v2 docs/superpowers/specs
./scripts/check-repo-access.sh HuyNguyen260398 aws-eks-infra main docs/operations
```

Expected: two `PASS … resolved to <sha>` lines. A `FAIL … authentication` or `repository not found` means the GitHub App installation lacks the repository: add it (Step 5) and re-run.

- [ ] **Step 13: Post the evidence on the PR and merge**

```bash
gh pr comment --body-file - <<EOF
Live acceptance on $(date -u +%F):

\`\`\`
$(cat /tmp/verify-platform.txt)
\`\`\`

Smoke: DNS from EC2 Pod ok; cashight NetworkPolicy dns-ok/egress-blocked; gp3 PVC Bound; check-repo-access PASS for cashight@cashight-v2 and aws-eks-infra@main.
EOF
gh pr merge --merge
```

- [ ] **Step 14: Point Argo CD back at `main`**

Delete the `gitops_revision = "feat/ec2-capacity-keda"` line and its comment from the local `terraform.tfvars`, then:

```bash
git switch main && git pull --ff-only
terraform -chdir=environments/platform plan -out=tfplan
```

Expected: one in-place update, the `platform-cluster` Secret's `gitops_revision` annotation (`feat/ec2-capacity-keda` → `main`). Nothing else changes.

```bash
terraform -chdir=environments/platform apply tfplan
kubectl -n argocd get applications -o wide
EXPECT_WORKLOADS=true ./scripts/verify-platform.sh
```

Expected: Applications re-sync from `main` with no resource changes, and every line is `PASS`. Delete the merged branch: `git push origin --delete feat/ec2-capacity-keda && git branch -d feat/ec2-capacity-keda`.

---

## Task 10: Merge `main` forward into `cashight-v2`

**Repo:** `cashight`.

Task 1 changed `main`. The branching rule (spec §1) is that fixes on `main` are merged forward into `cashight-v2`, never the reverse.

- [ ] **Step 1: Merge**

```bash
cd ~/ws/cashight
git fetch origin
git switch cashight-v2 && git pull --ff-only
git merge --no-edit origin/main
pnpm install --frozen-lockfile && pnpm tsc --noEmit && pnpm test
git push origin cashight-v2
```

Expected: a clean merge (Task 1 touched only `terraform/github-oidc.tf`, `infrastructure-deploy.yaml` and one doc, and `cashight-v2` does not modify those), typecheck clean, and all tests passing.

---

## Not in this plan (and where it goes)

- **HTTPS on the shared ALB → Plan 4.** `platform-public` listens on HTTP :80 only, and `listen-ports` is a group-level annotation that must be byte-identical on every member. Moving to `[{"HTTP":80},{"HTTPS":443}]` therefore changes Jenkins' Ingress in `aws-eks-infra` in the same change, and it needs the `api.cashight-v2.nghuy.link` ACM certificate to exist first.
- **Cashight's Pod Identity roles, worker scaler roles, ECR, DNS → Plan 4.** They consume this plan's SSM parameters and the KEDA trust contract in Task 5.
- **The `cashight` Argo CD Application → Plan 4.** Spec §4.5 places it in `aws-eks-infra/gitops/workloads/config/`.
- **Loki, Tempo, Mimir, Grafana, collectors → Plan 3.** They use the `gp3` default class and EC2 capacity from this plan.
- **Jenkins.** The reference repository deploys it by default (`gitops/workloads/config/charts/jenkins.yaml`). It is unrelated to Cashight and adds roughly $36/month of Fargate plus EFS. Whether to keep it is your call. This plan leaves it as it is.

## Self-review notes

- Spec §4.1 bullets: node group → Task 3. EBS CSI + Pod Identity Agent → Tasks 3–4. KEDA → Task 5. `cashight` namespace → Task 6. CodeConnections extended → Task 9 Step 5 (installation) and Step 12 (proof), with the boundary documented in Task 8. Identifiers as outputs/SSM → Task 7.
- Spec §5 phase 0: Terraform CI role (#113) → Task 1. Budget alarm → Tasks 2 and 9.5. Identity Center → Task 9.2. Phase 1 exit (`verify-platform.sh` passes with EC2 nodes) → Task 9.10.
- Every Review Focus line has a live test: items 1–3 in 9.11, item 4 in 9.10 (APIService assertion), item 5 in 9.12.
