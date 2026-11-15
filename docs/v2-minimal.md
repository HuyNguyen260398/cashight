# v2 minimal (always-on, Fargate only)

**v2 minimal** runs the v2 app (`cashight-v2.nghuy.link`, API `api.cashight-v2.nghuy.link`) **all the time**, at the lowest cost at which it still works, with no EC2 to manage. It is the second variant of the v2 infrastructure; the full platform ([`platform.md`](platform.md)) stays as it is for test days. **Only one of the two exists at a time.**

Design: [`docs/superpowers/specs/2026-11-08-cashight-v2-minimal-design.md`](superpowers/specs/2026-11-08-cashight-v2-minimal-design.md). Plan: [`docs/superpowers/plans/2026-11-09-cashight-v2-minimal.md`](superpowers/plans/2026-11-09-cashight-v2-minimal.md).

Every command runs from the repository root. If you sign in with `aws login`, export the session for Terraform first:

```bash
export AWS_REGION=ap-southeast-1
eval "$(aws configure export-credentials --format env)"
```

## 1. Overview and architecture

```
Browser ── CloudFront (cashight-v2.nghuy.link, terraform/v2, unchanged)
   │
   └── api.cashight-v2.nghuy.link ── ALB (public subnets, ACM cert from terraform/v2)
                                        │  target-type ip
                                        ▼
                        EKS cashight-v2-min (Fargate only, private subnets, 2 AZs)
                          ├─ cashight-api        ×1  (merged API, all routes)
                          ├─ aws-load-balancer-controller ×1
                          └─ coredns             ×1
                                        │
              private subnets ── NAT gateway (1 AZ) ── internet / AWS APIs
                              └─ S3 + DynamoDB gateway endpoints

uploads bucket ─(existing S3→SQS notification)─► cashight-v2-parse ─► Lambda cashight-v2-parser-worker
                                       cashight-v2-invoice-parse ─► Lambda cashight-v2-invoice-parser-worker
```

| Piece | Where | Notes |
|---|---|---|
| VPC, EKS (Fargate only), Fargate profiles `kube-system` and `cashight` | `terraform/modules/platform_cluster_fargate` | One NAT gateway; S3/DynamoDB gateway endpoints; no interface endpoints. Standard support only (`upgrade_policy = STANDARD`). Control-plane logging off, AWS-owned secrets key. |
| Root, state `cashight/v2-minimal/terraform.tfstate` | `terraform/v2-minimal` | Namespaces, LimitRange, Fargate logging, Load Balancer Controller (Helm 1.14.0), API IRSA role, both worker Lambdas, the API DNS record. Reads `terraform/v2` through `terraform_remote_state`. |
| Manifests | `deploy/cashight/overlays/v2-minimal` | Self-contained: ServiceAccount, ConfigMap, Deployment, Service, Ingress. Checked by `scripts/platform/check-minimal-manifests.sh`. |
| Release | `.github/workflows/v2-minimal-release.yaml` | Image → workers → `kubectl apply` → gates → SPA. |
| Reused unchanged | `terraform/v2` | Table, buckets, queues + DLQs, ECR, CloudFront SPA, certificates, CI role (plus two additive grants). |

Differences from the full platform: no node group, Argo CD, Argo Rollouts, KEDA, cert-manager, OpenTelemetry Collector, Pod Identity, NetworkPolicies or PDBs. `cashight-api` runs `/app/api-all/index.js`, which serves the `api` and `aws-api` routes in one process. The parse workers are SQS-triggered Lambdas again. **AI summaries are off**: `AI_SUMMARY_ENABLED=false` on the API (both summary routes answer 404, no Gemini grant or config) and `NEXT_PUBLIC_ENABLE_AI_SUMMARY=false` in the SPA build.

## 2. One-time setup

1. The persistent v2 root is applied ([`v2-resources.md`](v2-resources.md)), including the two v2-minimal grants on the CI role (`EksDescribeMinimal`, `DeployMinimalWorkers`): `terraform -chdir=terraform/v2 apply`.
2. Create `terraform/v2-minimal/terraform.tfvars` (gitignored) from `terraform.tfvars.example`, listing the IAM role(s) that get cluster-admin:

   ```hcl
   admin_principal_arns = ["arn:aws:iam::<account-id>:role/<admin-role>"]
   ```

3. `gh` is authenticated for this repository (`apply.sh` and `teardown.sh` set the repository variable `V2_TARGET`).
4. The repository variables the release reads already exist for the full platform: `V2_CI_ROLE_ARN`, `V2_ECR_REPOSITORY_URL`, `V2_FRONTEND_BUCKET`, `V2_CLOUDFRONT_DISTRIBUTION_ID`, `COGNITO_AUTHORITY`, `COGNITO_SPA_CLIENT_ID`, `COGNITO_USER_POOL_ID`, `COGNITO_SMOKE_CLIENT_ID`, `COGNITO_HOSTED_UI_DOMAIN`.

## 3. Apply

```bash
bash scripts/v2-minimal/apply.sh
```

It refuses while the full cluster `cashight-v2` exists, creates the cluster with a targeted apply (15–20 minutes), applies everything else, checks the committed overlay against the Terraform outputs (`scripts/v2-minimal/check-overlay.sh`), and sets `V2_TARGET=minimal`. Then:

1. `gh workflow run v2-minimal-release.yaml --ref cashight-v2`, and watch it go green. The first run deploys the API and creates the ALB. The API hostname has no DNS record yet, so the release checks `/health` and runs the smoke suite through the ALB directly (keeping the hostname for TLS) and leaves a notice saying so.
2. `bash scripts/v2-minimal/apply.sh` again: the ALB now exists, so `api.cashight-v2.nghuy.link` gets its A/AAAA records. There is no flag; the record appears whenever exactly one ALB carries the `cashight` Ingress-group tags of this cluster.
3. `terraform -chdir=terraform/grafana apply -var api_live=true -var collector_live=false` for the uptime check (there is no collector).

Re-running `apply.sh` is always safe.

## 4. Deploy and how the gate works

Every push to `cashight-v2` that touches the app, the overlay or the workflow (and `workflow_dispatch`) runs `v2-minimal-release.yaml`, **only when `V2_TARGET=minimal`**:

1. **image**: build and push `cashight-backend:<sha>-amd64` (x86_64: EKS on Fargate has no Graviton), resolve the digest, write it to the job summary. No pin commit.
2. **deploy**:
   1. `pnpm build:lambdas`; record the rollback state: the Deployment's current revision (`record-revision.sh`) and both `live` alias versions.
   2. `deploy-workers.sh`: for each worker, upload the zip, publish a version, wait, move `live`.
   3. Pin the digest and `APP_VERSION` (`pin-image.sh`), then `version-release.sh`: stamp the pod-template annotation `cashight.nghuy.link/app-version: <sha>` and rename the ConfigMap to `cashight-env-<sha12>`. The annotation changes on every commit, so a ConfigMap-only release still rolls a new pod with fresh env; the per-release name means a rollback brings back the old config with the old pod.
   4. `kubectl apply -k`, then `kubectl rollout status --timeout=5m`. The rollout is `maxSurge 1, maxUnavailable 0`, and the `cashight` namespace enables the load balancer controller's **pod readiness gate**: the new pod counts as Ready only once its ALB target is healthy, so the old pod keeps serving until then.
   5. `api-endpoint.sh` waits for the ALB, then `wait-revision.sh` polls `/health` for up to 180 s until it reports the newest ReplicaSet's `pod-template-hash`. While the old target drains it can still answer, so a single check could pass against it.
   6. Smoke suite against both hostnames with a freshly minted token (`mint-smoke-token.sh`), including `SMOKE_EXPECT_AI_SUMMARY_DISABLED=true`: both summary routes must answer 404.
   7. After the smoke suite passes, `prune-config.sh` deletes release ConfigMaps no retained ReplicaSet uses (a failure there does not fail the release).
   8. On any failure: `rollback.sh` (below), and the job fails.
3. **spa**: only after **deploy** passes, build the SPA with `NEXT_PUBLIC_ENABLE_AI_SUMMARY=false` and deploy it.

## 5. Rollback

**Automatic.** `scripts/v2-minimal/rollback.sh` runs on any failure in the deploy job:

- If the Deployment moved, `kubectl rollout undo --to-revision=<recorded>` back to exactly the revision recorded before the release, then waits for it. A release that failed before `kubectl apply` leaves the Deployment alone. On the first deploy there is nothing to roll back to, and the log says `no previous revision`.
- Each worker's `live` alias goes back to the version recorded before the release, even if only one had moved.
- Every step runs even if an earlier one errors, and the job always fails.
- The undo restores the pod template, which includes the image and (through the per-release ConfigMap name) the environment. It does **not** revert changes to the Service, Ingress or ServiceAccount; those change rarely, and a bad one still fails the job. Revert them by re-running the release of the previous good commit.

**Manual.**

```bash
aws eks update-kubeconfig --name cashight-v2-min
kubectl rollout history deployment/cashight-api -n cashight
kubectl rollout undo deployment/cashight-api -n cashight --to-revision=<N>
aws lambda list-versions-by-function --function-name cashight-v2-parser-worker --query 'Versions[].Version'
aws lambda update-alias --function-name cashight-v2-parser-worker --name live --function-version <V>
aws lambda update-alias --function-name cashight-v2-invoice-parser-worker --name live --function-version <V>
```

## 6. Mutual exclusion with the full platform

Both variants point `api.cashight-v2.nghuy.link` at their own ALB and would both consume the v2 queues, so only one may exist:

- `scripts/v2-minimal/apply.sh` refuses while `cashight-v2` exists, and `terraform/v2-minimal` itself fails its plan (`terraform_data.exclusive_with_full_platform`).
- `scripts/platform/bring-up.sh` refuses while `cashight-v2-min` exists: `bring-up: cashight-v2-min exists; run scripts/v2-minimal/teardown.sh first`. Both checks stop if they cannot tell (any error other than `ResourceNotFoundException`).
- The repository variable **`V2_TARGET`** (`full` | `minimal`, unset means `full`) picks the release workflow: with `minimal`, `v2-release.yaml` skips every job and `v2-minimal-release.yaml` runs; otherwise the reverse. `apply.sh` sets `minimal`, `teardown.sh` sets `full`.

To switch to a full-platform test day: tear v2 minimal down, run the full bring-up, and afterwards apply v2 minimal again.

## 7. Teardown

```bash
bash scripts/v2-minimal/teardown.sh "destroy cashight-v2-min"
```

In order: Grafana `api_live=false`; delete the `cashight` Ingress (the controller deletes its ALB); wait until no `k8s-cashight-*` load balancer remains; `terraform destroy` of `terraform/v2-minimal` (cluster, Lambdas, DNS record); `V2_TARGET=full`. `terraform/v2`, `platform-base` and Grafana remain.

## 8. Logs

- **App:** `cashight` namespace container stdout, shipped by Fargate's built-in Fluent Bit to `/cashight/v2-min/app` (7 days), streams `fargate-*`. The `aws-observability/aws-logging` ConfigMap (Terraform) filters on `^cashight$`.
- **Workers:** `/aws/lambda/cashight-v2-parser-worker` and `/aws/lambda/cashight-v2-invoice-parser-worker` (7 days).
- **kube-system logs (CoreDNS, the controller) are deliberately not shipped** (spec decision 3). Read them live: `kubectl logs -n kube-system deploy/aws-load-balancer-controller`.
- Control-plane logging is off.

## 9. Security note: the public endpoint

The EKS public endpoint is open to **`0.0.0.0/0`**. GitHub-hosted runners have no fixed IPs, and the endpoint allows at most 40 CIDRs. Access relies on **IAM authentication plus access entries**: the admin role(s) in `admin_principal_arns` get cluster-admin, and the CI role gets only `AmazonEKSEditPolicy` scoped to the `cashight` namespace. The full platform's check that `public_access_cidrs` excludes `0.0.0.0/0` therefore **does not apply** to v2 minimal (spec §6.2). Alternatives, if this is ever rejected: a CodeBuild project inside the VPC as the deploy runner, or a self-hosted runner.

## 10. Cost

Singapore, USD per month (730 h). "Estimate" is the spec's original figure, which assumed arm64 Fargate; "List price" is recomputed from the Price List API at x86 Fargate rates; the last column is filled in a week after go-live (Cost Explorer).

| Item | Estimate | List price (2026-11-15) | Actual run rate |
|---|---:|---:|---:|
| EKS control plane (standard support), $0.10/h | 73 | 73.00 | |
| NAT gateway, 1 AZ ($0.059/h, $0.059/GB), plus its public IPv4 ($0.005/h) and low data | 47 | ≈ 47.7 | |
| ALB ($0.0252/h), 2 public IPv4, 0.5–1 LCU ($0.008/LCU-h) | 27 | ≈ 28.6–31.5 | |
| Fargate x86 ($0.05056/vCPU-h, $0.00553/GB-h): `cashight-api` (0.25 vCPU / 0.5 GB since go-live; 1 GB before), LBC and CoreDNS (0.25 / 0.5 each) | 25–30 | 33.74 | |
| Lambda workers, SQS, DynamoDB, S3, CloudFront, ECR, CloudWatch Logs | 2–5 | 2–5 | |
| **Total** | **≈ 165–175** | **≈ 185–191** | |

**EKS on Fargate runs x86_64 only** (Graviton on Fargate is ECS-only; the Price List has no `AmazonEKS` ARM Fargate usage type). The spec's arm64 assumption was wrong, so the API image is amd64 and Fargate costs ≈ $7 more than estimated. The go-live stop line was raised from $185 to $200 accordingly. The worker Lambdas stay arm64.

Not everything is visible to the tag budget (§11): EKS, the NAT gateway, the Lambdas, the log groups and (through the controller's `defaultTags`) the ALB carry `Environment = v2-minimal`, but **Fargate pod compute (≈ $34) and public IPv4 (≈ $11) are not attributed to tags** unless EKS split cost allocation is enabled. Read it from Cost Explorer by service (Fargate) instead.

Extended support would add ≈ $365/month, which is why the root only accepts versions in standard support (`terraform/v2-minimal/variables.tf`; refresh the list before an upgrade) and sets `upgrade_policy = STANDARD`.

## 11. Enabling the tag budget

`terraform/platform-base` holds a $200/month budget filtered on `Environment = v2-minimal` (ACTUAL 80 % and 100 % alerts to the budget emails), off by default. It stays at $200 although the full run rate is ≈ $190: the tag filter misses Fargate and public IPv4 (§10), so the spend it sees is ≈ $140–146, under the $160 alert. A tag only becomes a usable filter about a day after its first billed usage, so after go-live:

1. Wait at least a day after the first apply.
2. Set `enable_v2_minimal_budget = true` in `terraform/platform-base/terraform.tfvars`.
3. `terraform -chdir=terraform/platform-base apply`. This also activates `Environment` as a cost allocation tag.

## 12. Acceptance record (2026-11-15)

Go-live from the workstation, following plan Task 11. All steps passed except the ones marked open.

| Step | Result |
|---|---|
| 1. Prices | Price List API, Singapore: ≈ $187–193/month at x86 Fargate prices (§10). **Found that EKS on Fargate has no Graviton**; the API image was switched to amd64 (`71f7083`) and the stop line raised to $200 before applying. |
| 2. Apply | `apply.sh`: 45 + 19 resources. `coredns` ×1 and `aws-load-balancer-controller` ×1 Running on `fargate-*` nodes. DNS from a `cashight` pod resolves `sts.ap-southeast-1.amazonaws.com`, so no `vpc-cni`/`kube-proxy` add-ons were needed. Kubernetes 1.35, `upgradePolicy` `STANDARD`. |
| 3. First deploy | Merge of PR #158 released through the ALB before DNS existed (run `43673542828`, green). Second `apply.sh` added the `api.cashight-v2.nghuy.link` A/AAAA records. Exactly three pods. `/health` → `ok`; `POST /api/summarize` → 404. |
| 3. Memory | `cashight-api` peak RSS (VmHWM) 122 MiB, cgroup max usage 80 MiB, after both uploads and dashboard loads. Request and limit lowered from 768Mi to 256Mi (`5da91c2`, run `43677502613`); Fargate now provisions 0.25 vCPU / 0.5 GB. |
| 4. Rollback | `c7466c0` made `isReady` return false (run `43674783158`): `rollout status` timed out, `rollback.sh` undid the Deployment to the recorded revision and pointed both `live` aliases back at version 2, then failed the job. `/health` kept serving `76db7989d4` throughout. The revert `230b03d` released green (run `43675422835`; aliases at version 4). |
| 5. Parsing | Uploaded both samples in the SPA. TPBank: card `9674`, `statementBalance 37978402`, `totalSpend 26986712`, `totalCashback 519020`, 41 transactions (read from the stored JSON). VIB: card `4550`, 2026-07-25, `statementBalance 5591567`, `totalInstallments 5581667`, fees 9900, spend 0, 3 transactions. Both ran in `cashight-v2-parser-worker` with no errors. No AI summary in the dashboard. |
| 5. DLQs | **One message each, not from go-live**: the `s3:TestEvent` S3 sent on 2026-11-08 when the upload bucket notification was created. The uploads added none. They expire around 2026-11-22 (14-day retention). |
| 6. Mutual exclusion | `bring-up.sh` refused: `cashight-v2-min exists; run scripts/v2-minimal/teardown.sh first` (exit 1). |
| 7. Logs and Grafana | `/cashight/v2-min/app` holds only `fargate-*` streams from `cashight` pods. Grafana applied with `api_live=true collector_live=false` (2 changed). **Open:** confirm the uptime check is green in the Grafana UI. |
| 8. Cost Explorer | **Open:** on or after 2026-11-22, record the run rate in §10, then enable the tag budget (§11). |

Observed, not blocking:

- The parser worker logs a pdf.js warning, `Cannot access the require function`, on each invocation. Parsing is unaffected.
- The workers send S3's `s3:TestEvent` to the DLQ after three attempts instead of ignoring it.

