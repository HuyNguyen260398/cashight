# EKS platform (v2 test environment)

The v2 platform is a **repeatable, on-demand test environment**: an EKS cluster you create for a test day and destroy the same day. It runs managed Argo CD, which reconciles `deploy/platform/` (and later `deploy/workloads/`) from the `cashight-v2` branch of this repository through AWS CodeConnections. The v1 serverless stack is not touched by anything here.

Background and decisions: [`docs/superpowers/specs/2026-11-05-eks-plan-4-open-points.md`](superpowers/specs/2026-11-05-eks-plan-4-open-points.md).

Every command runs from the repository root. If you sign in with `aws login`, export the session for Terraform first:

```bash
export AWS_REGION=ap-southeast-1
eval "$(aws configure export-credentials --format env)"
```

## 1. Roots and lifecycle

Anything destroyed with the cluster must not share a root with anything that must survive it, so the Terraform roots are split by lifecycle. All roots keep state in `cashight-tfstate` (KMS `alias/cashight-tfstate`) and are applied from the workstation only. CI (`Platform CI`, `Terraform CI`) runs `fmt`, `validate`, `test` and linters, never `plan` or `apply`.

| Root | Lifecycle | Holds |
|---|---|---|
| `terraform/` (existing) | Persistent. v1 lives here, so changes are **additions only** | Shared data, Cognito, the v1 stack, and (Plan 4b) the persistent v2 pieces |
| `terraform/platform-base/` | Persistent, rarely changed | Account budget, Identity Center group, CodeConnections connection (it needs a manual console handshake, so recreating it every day is not practical) |
| `terraform/platform/` | **Ephemeral**: `apply` → test → `destroy` the same day | VPC, EKS, 2 × `t4g.large` on-demand nodes, add-ons, managed Argo CD and its GitOps bootstrap, controller/KEDA/collector IAM |
| `terraform/grafana/` (existing) | Persistent | Grafana Cloud alerts, dashboard, uptime check ([observability](observability.md)) |

`terraform/platform` reads `platform-base` through `terraform_remote_state`. Nothing is published to SSM for other roots or repositories.

| Path | Synced by | Holds |
|---|---|---|
| `deploy/platform/bootstrap/` | the `platform-bootstrap` ApplicationSet Terraform creates | The three child ApplicationSets |
| `deploy/platform/config/addons/` | `platform-addons` | AWS Load Balancer Controller, cert-manager, Argo Rollouts, KEDA, OpenTelemetry Collector |
| `deploy/platform/charts/namespace-config/` + `config/namespaces/values.yaml` | `platform-namespaces` | The `cashight` namespace, quota, LimitRange, NetworkPolicies |
| `deploy/workloads/` | `platform-workloads` | Workload Application manifests: `cashight.yaml` syncs `deploy/cashight/overlays/v2` |

## 2. One-time setup

These steps create the persistent pieces. They cost almost nothing and survive every teardown.

### Prerequisites

```bash
./scripts/platform/verify-prerequisites.sh
```

It checks Terraform, the AWS CLI, kubectl, Helm, TFLint, Checkov, yamllint, kubeconform, Git, your caller identity and Region, exactly one IAM Identity Center instance, and access to this repository. It changes nothing.

Find the Identity Center user IDs that will administer Argo CD:

```bash
aws identitystore list-users \
  --identity-store-id "$(aws sso-admin list-instances --query 'Instances[0].IdentityStoreId' --output text)" \
  --query 'Users[].{id:UserId,name:UserName}' --output table
```

### Apply `platform-base`

```bash
cp terraform/platform-base/terraform.tfvars.example terraform/platform-base/terraform.tfvars   # then edit; gitignored
terraform -chdir=terraform/platform-base init
terraform -chdir=terraform/platform-base plan -out=tfplan
terraform -chdir=terraform/platform-base apply tfplan
```

The `cashight-account-monthly` budget is account-wide and alerts by email at 50/80/100 % of actual and 100 % of forecast spend. It exists before any cluster does.

### Complete the CodeConnections handshake

A new connection is created in `PENDING`. Open **CodePipeline → Settings → Connections** (Developer Tools → Settings → Connections), Region Singapore, select `cashight-github` and complete the GitHub authorization. The GitHub App installation must include **`HuyNguyen260398/cashight`**. The installation's repository list is the access boundary: the connection ARN is the only thing the Argo CD capability role can use.

```bash
aws codeconnections get-connection \
  --connection-arn "$(terraform -chdir=terraform/platform-base output -raw github_connection_arn)" \
  --query 'Connection.ConnectionStatus' --output text   # AVAILABLE
```

If it stays `PENDING`, re-open it in the console and finish the GitHub App install. If the app was installed against the wrong account, delete the connection in the console and re-apply `platform-base`.

### Create the Grafana Cloud parameters

The collector's init container reads three parameters under `/cashight/grafana-cloud/` (`otlp-token` as SecureString, `otlp-endpoint` and `instance-id` as String). They are created by hand so the token never enters Terraform state; see [observability](observability.md). Without them the collector Pod stays in `Init:CrashLoopBackOff` and its init container log names the missing parameter.

## 3. Bring-up

### Test day: one command

Prerequisites: `terraform/v2` applied ([v2 resources](v2-resources.md)), `terraform/platform/terraform.tfvars` holding your current egress `/32`, the `cashight-v2` branch pushed, and the **v2 Release** workflow having pinned a real image digest in `deploy/cashight/overlays/v2/kustomization.yaml` (bring-up refuses the all-zero placeholder).

```bash
export AWS_REGION=ap-southeast-1
eval "$(aws configure export-credentials --format env)"
bash scripts/platform/bring-up.sh
```

It runs, in order, stopping at the first failure:

1. Copies the AUTHZ records into the v2 table (`scripts/v2/seed-authz.ts`, dry run first).
2. Creates the cluster with the targeted apply, then waits for the Argo CD capability (up to 20 min).
3. Applies the bootstrap, then waits for the `cashight` Application to be `Synced` / `Healthy` (up to 15 min) and for its Ingress to get an ALB.
4. Applies again with `api_alb_ready=true`, which creates `api.cashight-v2.nghuy.link`.
5. Runs `scripts/platform/check-overlay.sh`: the bucket names, queue URLs, certificate, scaler roles, image repository and GitOps URL committed in `deploy/` must equal the Terraform outputs.
6. Waits for DNS and `/health`, mints a smoke token (client credentials on the smoke client) and runs `scripts/smoke-serverless.mjs` against both v2 hostnames.
7. Applies `terraform/grafana` with `api_live=true collector_live=true`, so the uptime and telemetry alerts are live only once v2 serves.

Each step is idempotent: after fixing a failure, run it again. Every Terraform step plans to a file and applies that plan without a prompt. Run the steps below by hand when you want to review each plan.

### Step by step

Argo CD reads GitHub, not your working tree: push the `cashight-v2` changes you want to test first.

```bash
cp terraform/platform/terraform.tfvars.example terraform/platform/terraform.tfvars   # your egress /32; gitignored
terraform -chdir=terraform/platform init
```

**The first apply targets the cluster module.** The bootstrap module writes Argo CD objects with `kubernetes_manifest`, which validates against a live API server — with the `ApplicationSet` CRD installed — during **plan**. On a fresh state there is no API server yet, so an untargeted plan fails.

```bash
terraform -chdir=terraform/platform plan -target=module.platform_cluster -out=tfplan
terraform -chdir=terraform/platform apply tfplan
```

Review the plan before applying: only additions, no NAT gateway, no Fargate profile, no `aws_ssm_parameter`, and a node group of 2. Terraform prints `Resource targeting is in effect`; that is expected. Expect 15–20 minutes, most of it the control plane.

Wait for the Argo CD capability. `DEGRADED`, `DELETING`, `CREATE_FAILED` and `UPDATE_FAILED` are terminal:

```bash
cluster="$(terraform -chdir=terraform/platform output -raw cluster_name)"   # cashight-v2
while :; do
  status="$(aws eks describe-capability --cluster-name "$cluster" --capability-name "${cluster}-argocd" --query 'capability.status' --output text)"
  case "$status" in
    ACTIVE) break ;;
    DEGRADED|DELETING|CREATE_FAILED|UPDATE_FAILED) echo "${cluster}-argocd is $status" >&2; break ;;
    *) echo "${cluster}-argocd is $status; waiting"; sleep 15 ;;
  esac
done
```

Then the full apply, which adds only the bootstrap (the Argo CD cluster `Secret` and the `platform-bootstrap` ApplicationSet):

```bash
aws eks update-kubeconfig --name cashight-v2 --region "$AWS_REGION"
kubectl api-resources | grep -E 'applications|applicationsets'   # both present
terraform -chdir=terraform/platform plan -out=tfplan
terraform -chdir=terraform/platform apply tfplan
```

Validate:

```bash
./scripts/platform/check-repo-access.sh HuyNguyen260398 cashight cashight-v2 deploy/platform
kubectl -n argocd get applicationsets
kubectl -n argocd get applications -o wide
./scripts/platform/verify-platform.sh
./scripts/platform/platform-info.sh
```

Expected: the root plus three child ApplicationSets (`platform-addons`, `platform-namespaces`, `platform-workloads`), every Application `Synced` / `Healthy`, and `verify-platform.sh` printing only `PASS`. It expects 2 nodes (`EXPECTED_NODES`) and no workloads; once Cashight is deployed run `EXPECT_WORKLOADS=true ./scripts/platform/verify-platform.sh`.

## 4. Cluster access

The cluster has private and CIDR-restricted public API access. Your source address must be in `public_access_cidrs`; the Terraform caller gets cluster-admin through an EKS access entry.

```bash
aws eks update-kubeconfig --region ap-southeast-1 --name cashight-v2
aws eks describe-nodegroup --cluster-name cashight-v2 --nodegroup-name cashight-v2-general --query 'nodegroup.status' --output text   # ACTIVE
kubectl get nodes -L kubernetes.io/arch,eks.amazonaws.com/capacityType,node.kubernetes.io/instance-type                                 # 2 arm64 ON_DEMAND t4g.large
kubectl get nodes -o jsonpath='{.items[*].status.capacity.pods}'; echo                                                                   # 110 110
kubectl -n kube-system get deployment coredns
```

**Capacity.** The EKS add-ons, the GitOps add-ons and Cashight share the two nodes. Memory is the limit, not Pod count: prefix delegation and `maxPods: 110` lift the per-node Pod limit. When `kubectl describe pod` shows `Insufficient memory`, raise `node_count` or pick a larger same-size Graviton type.

## 5. Teardown

### Test day: one command

```bash
bash scripts/platform/teardown.sh "destroy cashight-v2"
```

1. Applies `terraform/grafana` with `api_live=false collector_live=false` first, so the planned downtime does not page.
2. Deletes the `platform-workloads` ApplicationSet, so nothing regenerates the Cashight Application. Then it deletes the `cashight` Application. Its `resources-finalizer.argocd.argoproj.io` prunes the workloads and the Ingress, and the load balancer controller deletes the ALB.
3. Waits up to 10 min until no `k8s-cashight-*` load balancer remains, and stops, naming it, if one survives.
4. Runs `destroy-platform.sh "destroy platform"` (below), which also removes the `api.cashight-v2.nghuy.link` record. You confirm each of its plans.

`terraform/v2`, `platform-base` and Grafana survive. Then run the "Afterwards" checks below.

### Step by step

```bash
./scripts/platform/destroy-platform.sh "destroy platform"
```

The literal argument is required, and the script never uses `-auto-approve`, so you review each plan. It destroys the bootstrap first (its `kubernetes` provider needs the cluster endpoint), then everything else in `terraform/platform`. The budget, the CodeConnections connection and the Identity Center group are in `platform-base` and survive.

**Guards.** While the cluster is still in state the script refuses if `kubectl` cannot reach it (a stale kubeconfig must not read as "nothing deployed"), or if any of these exist:

1. A workload Argo CD Application: a source path under `deploy/cashight` or `deploy/workloads/…` (both `.spec.source.path` and every `.spec.sources[].path`), or the `cashight-v2-platform-workloads` app-of-apps (path `deploy/workloads`) while it still manages workload Applications. Empty, the app-of-apps is part of the platform and does not block.
2. An Ingress.
3. A LoadBalancer Service.

Guards 2 and 3 matter: the AWS Load Balancer Controller creates those load balancers and Terraform has no record of them. Destroy the cluster first and the ALB is orphaned; its ENIs and security groups then block the VPC destroy. The finalizer that releases them only works while the controller is running.

**Order.** On a test day with workloads, delete the `platform-workloads` ApplicationSet. Deleting a child Application alone does not work, because the app-of-apps recreates it from `deploy/workloads`. The deletion cascades to the app-of-apps, then the workload Applications, then their Ingress, whose finalizer blocks until the ALB is gone. Then confirm and run the script:

```bash
kubectl -n argocd delete applicationset platform-workloads
```

```bash
aws elbv2 describe-load-balancers --query 'length(LoadBalancers)' --output text   # 0
./scripts/platform/destroy-platform.sh "destroy platform"
```

**Afterwards**, check nothing was left behind:

```bash
aws eks list-clusters
aws elbv2 describe-load-balancers --query 'length(LoadBalancers)'
aws ec2 describe-nat-gateways --query 'NatGateways[?State!=`deleted`]'
terraform -chdir=terraform/platform state list   # empty
```

Two things are expected to remain: KMS keys in `PendingDeletion` (30-day window; each teardown adds a set), and stale entries in the Resource Groups Tagging API for recently deleted resources. Confirm against the service's own API before treating anything as a leftover.

The Grafana uptime and "telemetry stopped" alerts would fire while the cluster is down, so `teardown.sh` switches them off first and `bring-up.sh` switches them on last. If you tear down by hand, apply `terraform/grafana` with `-var api_live=false -var collector_live=false` first.

## 6. Known defects and recovery

The first end-to-end deployment of this platform (in its previous home) found ten defects, all fixed in the code ported here. The patterns behind them still apply.

**A misplaced or ignored key fails silently.** Argo CD's legacy fasttemplate treats an unresolvable `{{ .server }}` as a literal string, so every ApplicationSet here sets `goTemplate: true` and `goTemplateOptions: [missingkey=error]`. Helm ignores unknown values, so a key at the wrong nesting level is silently dropped. Audit every ApplicationSet when adding one:

```bash
grep -L 'goTemplate: true' $(grep -rl 'kind: ApplicationSet' deploy)   # prints nothing
```

**`directory.recurse` on a Kustomize directory** applies `kustomization.yaml` as a cluster resource. Use it only on plain-manifest directories (such as `deploy/workloads`).

**Namespaces.** A chart that installs into its own namespace needs `CreateNamespace=true` in its sync options.

**CRDs and API-server normalization.** CRDs the API server rewrites (for example Argo Rollouts') stay `OutOfSync` forever unless their sync uses `ServerSideApply=true` and the normalized fields are ignored.

**Argo CD abandons a failed sync.** After 5 retries automated sync stops and does not resume when the cause is fixed. Nudge it, top-down (root → child → leaf):

```bash
kubectl -n argocd annotate application <app> argocd.argoproj.io/refresh=hard --overwrite
kubectl -n argocd patch application <app> --type merge \
  -p '{"operation":{"initiatedBy":{"username":"admin"},"sync":{}}}'
```

**Fixing one layer reveals the next.** The chain is root → bootstrap children → add-on ApplicationSets → Applications; a layer that never rendered hides the defects below it. Audit the branch you deploy (`cashight-v2`), not `main`.

Recovery for the common failures:

| Symptom | Check |
|---|---|
| Node never `Ready` | `aws eks describe-nodegroup ... --query 'nodegroup.health'` and `aws eks describe-addon --addon-name vpc-cni`. The VPC CNI, kube-proxy and Pod Identity Agent are created before the node group; a node without a working CNI stays `NotReady`. |
| Webhook calls time out (`context deadline exceeded`) | The node security group admits the control plane only on 10250, 4443, 6443, 8443 and 9443. Keep webhooks on one of those ports. |
| Capability `CREATE_FAILED` / `DEGRADED` | `aws eks describe-capability ...` and `aws iam get-role --role-name cashight-v2-argocd-capability`. Usually IAM propagation or the trust policy (only `capabilities.eks.amazonaws.com`, `sts:AssumeRole` + `sts:TagSession`). |
| `Failed to construct REST client` during plan | The bootstrap was planned before the cluster and Argo CD CRDs existed, or kubeconfig/credentials expired. Re-run the targeted apply. |
| `Invalid count argument` during plan | A data source inside a child module resolved to unknown, which a module-level `depends_on` causes. Do not add `depends_on` to `module.eks`. |
| Application not `Synced` / `Healthy` | `kubectl -n argocd get application <name> -o jsonpath='{.status.conditions}'`. Check that the revision and path resolve, the change is pushed, the GitHub App installation includes the repo, and Pods fit (`Insufficient memory`). Values from `{{ .metadata.annotations.* }}` come from the cluster `Secret` Terraform writes (`terraform/modules/platform_bootstrap`); add missing ones there, not in YAML. |
| Collector `Init:CrashLoopBackOff` | A `/cashight/grafana-cloud/*` parameter is missing; the init container log names it. |

There is no partial rollback for a half-applied cluster: fix the input and re-run the step, or tear down and start again.

## 7. Cost

Singapore list prices; verify before relying on them. A test day is roughly:

| Item | USD / day |
|---|---:|
| EKS control plane (0.10 / hour) | ≈ 2.40 |
| 2 × `t4g.large` on-demand (≈ 0.085 / hour each) | ≈ 4.10 |
| Managed Argo CD capability (≈ 27 / month + 1.32 per Application / month) | ≈ 1 |
| Root volumes, node public IPv4, control-plane logs, KMS | ≈ 0.30 |
| **Test day without workloads** | **≈ 8** |
| Shared ALB, once Plan 4c adds an Ingress | + ≈ 0.85 |

Nothing here is covered by the AWS free tier, and everything in `terraform/platform` bills from the moment it exists, so destroy the cluster when the test day ends. The `platform-base` pieces cost nothing measurable, and its USD 50 budget leaves headroom over the v1 stack.
