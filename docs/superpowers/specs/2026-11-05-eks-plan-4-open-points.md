# EKS migration — open points to settle before writing Plan 4

**Date:** 2026-11-05 · **Status:** all points answered (1–8, F1–F7); ready for Plan 4a
**Context:** Plans 1–3 are merged. No EKS cluster exists; `enable_argocd = false`; `api_live = false`. Plan 4 (spec §5 phases 4 and 5) cannot be written until the points below are answered. Record each answer inline (replace `Answer: _pending_`) and copy the decisions into Plan 4's header.

Spec: [`2026-10-08-eks-migration-design.md`](./2026-10-08-eks-migration-design.md)

---

## 1. Where the platform infrastructure lives (repo ownership)

**Raised 2026-11-05.** The spec §1 decided "the cluster and platform add-ons live in the existing `aws-eks-infra` repo; Cashight is a workload on it", and Plans 2 and 3 built on that (`aws-eks-infra` #17, #18). The intent is now that **all infrastructure code lives in `cashight`** and `aws-eks-infra` is a reference repo only, with no coupling to Cashight.

What lives in `aws-eks-infra` today and would have to move:

| Item | Where in `aws-eks-infra` | Live? |
|---|---|---|
| VPC, EKS cluster, Spot node group, add-ons, budget, SSM identifier parameters | `environments/platform`, `modules/platform_cluster` | Partly: budget, Identity Center group and CodeConnections were applied (Plan 2 Stages 1–3); cluster not created |
| Terraform state bucket + KMS | `bootstrap/terraform-state` | Yes |
| Managed Argo CD bootstrap, cluster Secret annotations | `modules/platform_cluster_bootstrap` | No (`enable_argocd = false`) |
| GitOps add-ons: ALB controller, cert-manager, Argo Rollouts, KEDA, OTel Collector, `cashight` namespace chart | `gitops/platform/` | No |
| IAM for ALB controller, KEDA operator, OTel Collector | `modules/platform_cluster/iam_*.tf` | No |
| Scripts: `verify-platform.sh`, `check-repo-access.sh`, `render-collector.sh`, `check-collector.sh` | `scripts/` | n/a |

Decisions needed:

- **1a.** Confirm: move everything above into `cashight` (proposed layout: `terraform/platform/` as a new Terraform root with its own state key in `cashight-tfstate`, and `deploy/platform/` for the Argo CD add-ons next to `deploy/` for the app).
- **1b.** Live resources already applied from `aws-eks-infra` (budget, Identity Center group, CodeConnections, state bucket): import them into the new `cashight` root (`terraform import` / `import` blocks, then remove from the old state), or destroy and recreate?
- **1c.** Keep the SSM-parameter contract between the platform root and the app root (`/platform/aws-eks-infra/...`, `/<prefix>/platform/...`), or replace it with direct `terraform_remote_state` / a single root? The Grafana SSM names under `/platform/aws-eks-infra/grafana-cloud/` are already created by hand and referenced by `cashight` docs.
- **1d.** One Terraform root for platform + app resources, or two (platform, app)? Two keeps cluster lifecycle separate from the app's ECR/IAM/DNS changes.
- **1e.** What happens to `aws-eks-infra` afterwards: revert it to the generic reference (pre-#17), or leave as-is and simply stop depending on it?

Answer: 
- 1a: confirmed
- 1b: destroy and recreate
- 1c: replace it, remove all the references between aws-eks-infra and cashight
- 1d: go with the best practices decision
- 1e: revert it to the generic reference

## 2. Go / no-go on cost

Spec §7 calls for an explicit go/no-go after phase 2 — that point is now. Plan 4 creates the cluster. Estimated run cost (Plan 2 revision): ≈ $96/month platform + ≈ $27 + $1.32/Application for managed Argo CD + ≈ $26 shared ALB ≈ **$150/month**, versus ≈ $1.36/month today. Also confirm the budget alarm threshold (`monthly_budget_usd`) fits that.

Answer:
we will create the cluster, but for testing only and it will be torn-down within 1 day to save costs, with this decision, we can upgrade the cluster specifications a little bit to the point that our app can be running stable

## 3. `auth-guard` Lambda deployment (spec §9.4)

The Cognito trigger stays a Lambda. Keep its CodeDeploy canary, or deploy it as a plain Terraform-managed zip once CodeDeploy is removed for the other 11 Lambdas?

Answer:
it should be deployed by terraform, but the removal must not effect the current infra (cashight v1), the 2 versions of infra for cashight will be running in parallel so the current infra must not be changed to keep it continue to work

## 4. Cognito app client for the v2 frontend (spec §9.5)

- Reuse the existing SPA app client and add the `cashight-v2.nghuy.link` callback / sign-out URLs (simpler; what the rename wants), or
- a separate app client (isolates the v2 sign-in config; must be swapped at the rename).

Answer:
for now we can reuse it

## 5. CloudFront for the v2 frontend (spec §9.6)

- A separate distribution for `cashight-v2.nghuy.link` (current edge untouched until the rename), or
- a second origin + alias on the existing distribution.

Answer:
go with the least effort of setup, so a separate distribution for `cashight-v2.nghuy.link` should be the option

## 6. Node capacity on the single Spot node

One `t4g.medium` (4 GiB) must hold the controllers, the collector, `cashight-api` and `cashight-aws-api` (2 replicas each per spec §4.2), and the workers (Lambda sizes 1.5 GiB / 2 GiB). Options:

- Keep `t4g.medium`, measure real usage, set requests ≈ 0.75 GiB with burst limits, and drop the APIs to 1 replica (a PDB adds nothing on one node), or
- raise `node_instance_types` to an 8 GiB type (one variable, higher cost).

Also: is a single Spot node acceptable only for the parallel run, or also after the rename (phase 7)? An interruption takes the whole API down.

Answer:
for now we can config the eks cluster with a little bit of higher specs so the app could run stable, the whole cluster will be torn-down within 1 day to save costs

## 7. Image-digest commits after the rename (spec §9.1) — can wait

Until the rename, Argo CD tracks `cashight-v2`, which the `main` ruleset does not protect, so CI can commit digests directly. After the merge to `main` (Plan 5), digest updates need either a bot identity with ruleset bypass or an auto-merged PR. Not blocking Plan 4; decide before Plan 5.

Answer:
for now, keep tracking the cashight-v2

## 8. Split Plan 4?

Plan 4 spans two phases. Proposal: **4a** — deferred Plan 1 hardening + Cashight AWS resources (ECR, Pod Identity roles, KEDA scaler roles, v2 DNS/ACM, v2 SPA origin, Cognito/S3 CORS allowlists), no cluster, near-zero cost; **4b** — cluster creation, Argo CD, `deploy/` manifests, image pipeline, Plan 3 handover. If point 1 moves the platform into `cashight`, the platform port lands in 4b (or its own 4-platform plan before 4b).

Answer:
keep plan 4 spans in separated phases

---

## Review of the answers (2026-11-05)

### Proposed resolution for 1d (best practice: split roots by lifecycle)

The "tear down within a day" answer (point 2) makes lifecycle the deciding factor. Anything destroyed with the cluster must not share a root with anything that must survive it.

| Root | Lifecycle | Holds |
|---|---|---|
| `terraform/` (existing) | Persistent. v1 lives here, so changes are **additions only** | Shared data, Cognito, v1 stack (unchanged), plus persistent v2 pieces: ECR, v2 ACM certificates, v2 SPA bucket + CloudFront distribution + `cashight-v2.nghuy.link` record, v2 Cognito callback URLs, S3 CORS entries |
| `terraform/platform-base/` (new) | Persistent, rarely changed | Account budget, Identity Center group, CodeConnections connection (it needs a manual console handshake, so recreating it every day is not practical) |
| `terraform/platform/` (new) | **Ephemeral**: `apply` → test → `destroy` the same day | VPC, EKS, node group, add-ons, managed Argo CD + bootstrap, controller/KEDA/collector IAM, the 4 workload Pod Identity roles + associations, KEDA scaler roles, `api.cashight-v2.nghuy.link` record |
| `terraform/grafana/` (existing) | Persistent | Unchanged, apart from the SSM rename in 1c |

The roots pass values through `terraform_remote_state` or plain data sources, not SSM (answer 1c). In-cluster add-ons go under `deploy/platform/` and the app goes under `deploy/cashight/`, both synced by Argo CD from `cashight-v2`.

### Consequences of the answers that Plan 4 must handle

- **1b order matters.** Create the budget in `platform-base` *before* destroying the one in `aws-eks-infra`, so the account is never without an alarm. Destroy the `aws-eks-infra` live resources using its current (#18) code, then revert the repo. Reverting first leaves state that no longer matches the code.
- **1c.** The Grafana SSM parameters under `/platform/aws-eks-infra/grafana-cloud/` were created by hand. Recreate them under a `cashight` prefix (e.g. `/cashight/grafana-cloud/…`), update `terraform/grafana`, the collector config and the docs from commit `e802d1b`, then delete the old ones.
- **1e.** Reverting to the generic reference means reverting `aws-eks-infra` #17 and #18 (back to #16, `7badc4f`), and the README stops calling the repo "Cashight EKS Platform". This is the last step, after the port is proven.
- **Daily teardown needs its own script.** The ALB and its security groups are created by the load balancer controller, not by Terraform. If the Ingress is not deleted first, `terraform destroy` hangs on the VPC. The order is: delete the Ingress, wait for the ALB to go, delete the Argo CD Applications, then run `terraform destroy`. Bring-up and teardown are each one command plus a runbook.
- **Grafana alerts during downtime.** Rule 2 (telemetry stopped) is always active, so it fires on every teardown. The bring-up and teardown scripts should flip `api_live` and pause or resume rule 2 with it.
- **Point 4 (reuse the SPA client)** adds v2 callback and sign-out URLs to the shared v1 app client. That is a change to a v1 resource, though purely additive (see F3).
- **Points 5 and 7** need no further work: a separate distribution, and Argo CD tracking `cashight-v2`.

## Follow-ups (please answer)

### F1. What is the cluster for: a one-off test or a repeatable environment? Is the full cutover still the goal?

"Torn down within 1 day" conflicts with the spec's phase 6 (two-week soak on `cashight-v2.nghuy.link`) and phase 7 (retire v1, rename). Choose one:
- (a) **Repeatable on-demand test env**: bring up, test, tear down, as often as needed. Cutover is deferred and decided later. Plan 5 is parked.
- (b) **One-off proof**: one bring-up to prove v2 works, then decide whether to do the cutover with a persistent cluster.
- (c) Cutover still planned. The ephemeral cluster is only the first step.

Answer: Repeatable on-demand test environment for now (option a). Cutover is deferred; Plan 5 is parked.

### F2. `auth-guard`: change it only at phase 7?

`auth-guard` is one Lambda attached to the shared user pool, so it is part of v1 *and* v2. Any change to how it is deployed changes v1. To keep v1 untouched, Plan 4 leaves `auth-guard` as it is. The switch to a Terraform-deployed zip happens when v1 is retired (phase 7). Confirm?

Answer: Do not change `auth-guard` in Plan 4.

### F3. Are additive changes to shared v1 resources acceptable?

v2 cannot sign in or upload without these:
- v2 callback / sign-out URLs added to the existing Cognito SPA client (your answer 4)
- the v2 origin added to the CORS rules of the statements and uploads buckets
- new resources added to the existing `terraform/` root (plan shows only additions; nothing that serves `cashight.nghuy.link` changes)

Confirm these count as "not changing v1"?

Answer: Acceptable.

### F4. How the v2 workers get messages without touching v1

Uploads go to one bucket, which notifies one SQS queue, which the v1 Lambdas consume. The spec's plan was to disable the Lambda event source mappings during the soak, and that changes v1. Options:
- (a) **Separate v2 intake (recommended)**: a v2 uploads bucket with its own notifications, parse queue, invoice-parse queue and DLQs. v2 APIs presign to it, and v2 workers consume it. v1 is fully untouched. Statements bucket and table stay shared.
- (b) Competing consumers on the shared queues: KEDA workers and the Lambdas both attached. No v1 change, since handlers are idempotent. But which stack parses a given upload is random, so v2 workers are not reliably proven, and v1 uploads may get parsed by a cluster that disappears mid-job.
- (c) Do not run the workers on EKS during tests.

Answer: Option (a): v2 gets its own uploads bucket and queues; v1 is untouched.

### F5. Node spec for the test cluster

The cluster only lives for hours, so Spot savings are negligible, and on-demand avoids interruptions mid-test. Recommendation: **2 × `t4g.large` on-demand (16 GiB total), one per AZ**. That keeps the spec's sizing (2 replicas per API with a PDB that means something, workers at the Lambda sizes of 1.5 / 2 GiB) without measuring and squeezing. Rough cost: control plane + 2 nodes + ALB + Argo CD is a few dollars per test day. Alternative: 1 × `t4g.xlarge` (16 GiB, simpler, single point of failure). Leave the budget alarm as it is.

Answer: Approved: 2 × `t4g.large` on-demand, one per AZ.

### F6. Plan split

Reading answer 8 as "one plan per unit, not one big Plan 4". With the platform port added, proposed:
- **4a** Platform port: `platform-base` + `platform` roots and `deploy/platform/` add-ons moved into `cashight`, SSM decoupling, old `aws-eks-infra` resources destroyed and the repo reverted. No cluster apply.
- **4b** Persistent v2 AWS resources (spec phase 4) + deferred Plan 1 hardening. Additive to `terraform/`, near-zero cost.
- **4c** Ephemeral bring-up (spec phase 5): cluster, Argo CD, `deploy/cashight/` manifests, image pipeline, v2 SPA build, Plan 3 handover items, the teardown script, smoke tests on the v2 hostnames.

Confirm, or describe the split you meant.

Answer: Approved: 4a platform port, 4b persistent v2 AWS resources + hardening, 4c ephemeral bring-up.

### F7. Testing against production data

v2 shares the production DynamoDB table and statements bucket (no data migration, per spec). A v2 bug found during a test day therefore writes to the real data v1 shows. Acceptable (handlers are unchanged, and S3 versioning keeps 90 days), or should v2 use its own table and bucket while it is ephemeral?

Answer: v2 uses its own data stores.

## Consequences of F1–F7 (recorded 2026-11-05)

- **v2 data stores (F4 + F7).** In the persistent `terraform/` root, as additions, v2 gets its own copies of the DynamoDB table, the statements bucket, the uploads bucket with its S3 notifications, the parse and invoice-parse queues with their DLQs, and the cost-exports bucket. v2 data survives teardowns. v1's buckets, table and queues get no new entries, so the S3 CORS additions in F3 apply only to the v2 buckets. The only v1 resource that changes is the shared Cognito SPA client, which gets the v2 callback and sign-out URLs. Cost Explorer and Billing reads are account-level and read-only, so they stay shared by nature.
- **The authorization record is found only in the v1 table (F2 + F7).** At sign-in, `auth-guard` writes `AUTHZ#<sub>` / `PROFILE` to the **v1** table (`TABLE_NAME`). Every API reads it through `getAuthorizedUser`, the 4 AWS-billing handlers explicitly and the others through `extractAccessClaims`. Because `auth-guard` stays unchanged, the v2 table never gets that record, and every v2 API would deny access. Resolution: a seed script in 4b copies the record from the v1 table into the v2 table. It reads v1 only, and the copy is idempotent, so it is safe to re-run on each bring-up. Limitation: if the record ever changes in v1 (for example a workspace change), v2 holds a stale copy until the script runs again. That is acceptable for a test environment.
- **F1.** Bring-up and teardown are each a repeatable command plus a runbook, and are part of 4c's acceptance criteria. Spec phases 6–7 and Plan 5 are parked. Update the spec's §1 and §5 to say so when Plan 4a lands.
- **F5.** The `t4g.medium` Spot node from the Plan 2 revision is replaced by 2 × `t4g.large` on-demand nodes, and the spec's §4.2 sizing (2 API replicas with a PDB, Lambda-sized worker memory) is restored. The Plan 3 collector footprint is unchanged.
