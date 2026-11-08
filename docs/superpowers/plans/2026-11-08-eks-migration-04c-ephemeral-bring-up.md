# EKS migration 4c — ephemeral bring-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the v2 stack runnable for a test day with one bring-up command and one teardown command. That covers the cluster, Argo CD, Cashight's four workloads on `api.cashight-v2.nghuy.link`, the image and SPA pipeline on `cashight-v2`, and smoke tests. Teardown leaves nothing billable behind.

**Architecture:** `terraform/platform` (ephemeral) gains the workload Pod Identity roles, the KEDA scaler roles and the `api.cashight-v2` DNS record. It reads the v2 data stores from `terraform/v2` through `terraform_remote_state`. `deploy/cashight/` holds a Kustomize base and a `v2` overlay. Argo CD syncs it from `cashight-v2` through one Application in `deploy/workloads/`. A workflow on pushes to `cashight-v2` builds the arm64 image, pins its digest in the overlay, and deploys the v2 SPA. `scripts/platform/bring-up.sh` and `teardown.sh` wrap Terraform, the AUTHZ seed, the Grafana switches and the smoke tests.

**Tech Stack:** Terraform 1.15 (AWS provider, `terraform test` with mock providers), EKS Pod Identity, Argo CD (managed capability), Argo Rollouts 2.40, KEDA 2.21, AWS Load Balancer Controller 1.14, Kustomize, kubeconform, GitHub Actions (`ubuntu-24.04-arm`), Node 24 for the scripts.

**Spec:** `docs/superpowers/specs/2026-10-08-eks-migration-design.md` (§4.2, §4.5, phase 5), with the decisions in `docs/superpowers/specs/2026-11-05-eks-plan-4-open-points.md` (F1–F7). Handovers: Plan 4b "Handover to Plan 4c", Plan 4a "Handover to Plan 4b", Plan 3 "Handover to Plan 4".

## Global Constraints

- **v1 is untouched.** No file under `terraform/*.tf` (the v1 root), no v1 workflow, and no v1 AWS resource changes in this plan.
- **Branching:** work branches from `cashight-v2` and PRs into `cashight-v2`. Argo CD tracks `cashight-v2` (decision 7).
- **Roots are applied from the workstation only.** CI runs `fmt`, `validate`, `test`, TFLint and Checkov, never `plan` or `apply`.
- **Nodes are arm64** (`t4g.large`, `AL2023_ARM_64_STANDARD`). Images are `linux/arm64`, built natively on `ubuntu-24.04-arm`.
- **The v2 CI role trusts exactly `repo:HuyNguyen260398/cashight:ref:refs/heads/cashight-v2`.** No job that assumes it may set `environment:`, because that changes the OIDC `sub` claim. Its inputs come from repository variables only.
- **Namespace contract (`deploy/platform/config/namespaces/values.yaml`):** Pod Security `restricted`. Default-deny ingress and egress, with DNS allowed. Quota `requests.cpu: 3`, `requests.memory: 12Gi`, `limits.memory: 16Gi`, `pods: 30`. LimitRange max `3Gi` per container. Every Cashight manifest must fit inside it, including canary surge.
- **Images are pinned by digest** (`<repo>@sha256:…`), never by tag.
- **Workload env (Plan 4b handover):** `TABLE_NAME=cashight-v2`, the v2 bucket names, the v2 queue URLs, `ALLOWED_ORIGIN=https://cashight-v2.nghuy.link`, the v1 `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_IDS=<SPA client>,<smoke client>`, `OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector.observability:4318`, `APP_VERSION=<commit sha>`.
- **Secrets stay in SSM.** `GEMINI_PARAM=/cashight/prod/gemini-api-key` and `PDF_PASSWORD_PARAM=/cashight/prod/pdf-password` are the shared v1 parameters, granted read-only. No secret value appears in a manifest, env var or workflow log.
- **Privacy rules carry over:** no PAN, description, cardholder name, email or token in logs, span attributes or metric labels.
- **Sizing (spec §4.2, F5):**

| Workload | Kind | Replicas | Memory request / limit | CPU request | `terminationGracePeriodSeconds` |
|---|---|---|---|---|---|
| `cashight-api` | Rollout | 2, PDB `minAvailable: 1` | 256Mi / 512Mi | 100m | 45 |
| `cashight-aws-api` | Rollout | 2, PDB `minAvailable: 1` | 512Mi / 1Gi | 100m | 45 |
| `parser-worker` | Deployment + ScaledObject | 0–2 | 1536Mi / 1536Mi | 250m | 150 (`MAX_PROCESSING_SECONDS=120`) |
| `invoice-parser-worker` | Deployment + ScaledObject | 0–1 | 2Gi / 2Gi | 250m | 330 (`MAX_PROCESSING_SECONDS=300`) |

## Review Focus

1. **A teardown that runs while the ALB still exists hangs the VPC destroy.** `teardown.sh` must delete the Cashight Application with cascade, wait until no Ingress and no `k8s-cashight-*` load balancer remains, and only then call `destroy-platform.sh`. Expected: teardown either finishes cleanly or stops with a named leftover, and never hangs. Pinned in Task 5.
2. **Overlay values drifting from Terraform outputs.** The bucket names, queue URLs, certificate ARN and scaler role ARNs are committed in the overlay. A re-created v2 resource silently breaks every request. Expected: bring-up refuses to continue when the overlay disagrees with `terraform output`. Pinned in Task 3 (`check-overlay.sh`) and called by Task 5.
3. **The ALB cannot reach pods under default-deny.** Ingress in `ip` target mode arrives from the VPC CIDR. Without an allow-policy, targets stay unhealthy and every request answers 502 or 503. Expected: the API NetworkPolicy admits TCP 8080 from `10.0.0.0/16` only. Pinned in Task 3 (rendered-manifest assertion).
4. **Running the image workflow twice in a row loses a digest commit.** Two pushes race on the overlay commit. Expected: the workflow serialises on one concurrency group and rebases before pushing. Pinned in Task 4.
5. **Grafana pages during planned downtime.** If the alerts stay live while the cluster is down, the uptime and telemetry rules fire on every teardown. Expected: teardown sets `api_live=false collector_live=false` before deleting anything, and bring-up sets them true only after smoke passes. Pinned in Task 5.

---

### Task 1: Workload IAM in `terraform/platform`

**Files:**
- Create: `terraform/platform/workloads.tf`
- Modify: `terraform/platform/main.tf` (add `data "terraform_remote_state" "v2"`), `terraform/platform/outputs.tf`
- Test: `terraform/platform/tests/platform.tftest.hcl` (add `override_data` for `v2`, new `run` blocks)

**Interfaces:**
- Consumes: `terraform/v2` outputs (`table_arn`, `statements_bucket_arn`, `uploads_bucket_arn`, `cost_exports_bucket_arn`, `parse_queue_arn`, `invoice_parse_queue_arn`) from state key `cashight/v2/terraform.tfstate`. Also `module.platform_cluster.keda_operator_role_arn` and `module.platform_cluster.cluster_name`.
- Produces: IAM roles named `cashight-v2-api`, `cashight-v2-aws-api`, `cashight-v2-parser-worker`, `cashight-v2-invoice-parser-worker`, `cashight-v2-keda-parse`, `cashight-v2-keda-invoice-parse`. Pod Identity associations in namespace `cashight` for ServiceAccounts `cashight-api`, `cashight-aws-api`, `parser-worker`, `invoice-parser-worker`. Output `keda_scaler_role_arns` (map: `parse`, `invoice_parse`).

- [ ] **Step 1: Write the failing tests.** Add `run "workload_roles"` (command = plan, `enable_argocd = true`) asserting:
  - `length(aws_eks_pod_identity_association.workload) == 4`, and each association's `namespace == "cashight"`.
  - `aws_iam_role.workload["api"].name == "cashight-v2-api"`.
  - The test file mocks every `aws_iam_policy_document` to an empty `json`, so assert on the data sources' **arguments**, not on rendered JSON:
    - The KEDA scaler trust names the operator role: `contains(flatten([for s in data.aws_iam_policy_document.keda_scaler_trust["parse"].statement : [for p in s.principals : p.identifiers]]), module.platform_cluster.keda_operator_role_arn)`.
    - The parse scaler policy allows only `sqs:GetQueueAttributes`: `data.aws_iam_policy_document.keda_scaler["parse"].statement[0].actions == toset(["sqs:GetQueueAttributes"])`, with exactly one statement.
    - No statement in `data.aws_iam_policy_document.workload[*]` has an action ending in `:*`. No resource is `"*"` except in `aws-api`'s statements with sids `CostExplorerRead` and `BillingRead`.

- [ ] **Step 2: Run the tests to verify they fail.** Run: `terraform -chdir=terraform/platform test`. Expected: FAIL, resources not declared.

- [ ] **Step 3: Implement `workloads.tf`.** One `aws_iam_role.workload` (`for_each` over the four keys) trusting `pods.eks.amazonaws.com` with the same `aws:SourceAccount` and `aws:SourceArn` conditions as `modules/platform_cluster/iam_pod_identity.tf`. One `aws_iam_role_policy` per workload. Each policy is the union of its former Lambdas' statements in `terraform/compute.tf`, pointed at the v2 ARNs and keeping the same key prefixes:
  - `api`: uploads, upload-status, statements, dashboard, summary and session-capabilities.
  - `aws-api`: cost-explorer, aws-invoices and aws-invoice-summary, including `ce:*` reads, `billing:ListBillingViews`/`GetBillingView` and `aws-portal:ViewBilling`.
  - `parser-worker` and `invoice-parser-worker`: their v1 policies, plus `sqs:ReceiveMessage`, `DeleteMessage`, `ChangeMessageVisibility` and `GetQueueAttributes` on their own queue only. The invoice worker keeps `s3:ListBucket` on the statements bucket (see the v1 comment for why).
  - SSM: `ssm:GetParameter` on `arn:aws:ssm:${var.aws_region}:${account}:parameter/cashight/prod/gemini-api-key` for both APIs, and on `/cashight/prod/pdf-password` for `parser-worker` only.
  - Drop the X-Ray statements. Telemetry goes to the collector.
  - `aws_iam_role.keda_scaler` (`for_each`: `parse`, `invoice_parse`) trusts `module.platform_cluster.keda_operator_role_arn` for `sts:AssumeRole` and `sts:TagSession`, and allows only `sqs:GetQueueAttributes` on its queue.

- [ ] **Step 4: Run tests, fmt, validate, TFLint and Checkov.** Run: `terraform -chdir=terraform/platform fmt -check && terraform -chdir=terraform/platform test`, then the TFLint and Checkov commands from `.github/workflows/platform-ci.yaml`. Expected: PASS. Any Checkov skip carries a one-line reason, as the existing ones do.

- [ ] **Step 5: Commit.** `git commit -m "feat(platform): add the v2 workload Pod Identity and KEDA scaler roles"`

### Task 2: `api.cashight-v2.nghuy.link` record

**Files:**
- Modify: `terraform/platform/workloads.tf`, `terraform/platform/variables.tf`, `terraform/platform/outputs.tf`
- Test: `terraform/platform/tests/platform.tftest.hcl`

**Interfaces:**
- Produces: variable `api_alb_ready` (bool, default `false`). When true, `data "aws_lb" "cashight"` looks the ALB up by tags `elbv2.k8s.aws/cluster = <cluster_name>` and `ingress.k8s.aws/stack = cashight`, and `aws_route53_record.api` (A and AAAA alias) creates `api.cashight-v2.nghuy.link` in zone `nghuy.link`. Output `api_hostname`.

- [ ] **Step 1: Write the failing tests.** `run "api_record_off_by_default"` asserts `length(aws_route53_record.api) == 0`. `run "api_record_on"` sets `api_alb_ready = true`, mocks `data.aws_lb.cashight` (`dns_name`, `zone_id`), and asserts both record types exist with name `api.cashight-v2.nghuy.link`.
- [ ] **Step 2: Run them to verify they fail.** Run: `terraform -chdir=terraform/platform test`. Expected: FAIL.
- [ ] **Step 3: Implement.** Use `count = var.api_alb_ready ? 1 : 0` on the data source and `for_each = var.api_alb_ready ? toset(["A","AAAA"]) : toset([])` on the record. The record is destroyed with the root, so no stale DNS survives teardown.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(platform): point api.cashight-v2.nghuy.link at the cluster ALB"`

### Task 3: `deploy/cashight/` manifests and the Argo CD Application

**Files:**
- Create: `deploy/cashight/base/` containing `kustomization.yaml`, `serviceaccounts.yaml`, `api-rollout.yaml`, `aws-api-rollout.yaml`, `services.yaml`, `pdbs.yaml`, `workers.yaml`, `scaledobjects.yaml`, `networkpolicies.yaml`, `smoke-analysis.yaml`
- Create: `deploy/cashight/overlays/v2/kustomization.yaml`, `deploy/cashight/overlays/v2/env.yaml` (ConfigMap `cashight-env`), `deploy/cashight/overlays/v2/ingress.yaml`
- Create: `deploy/workloads/cashight.yaml` (Argo CD `Application`)
- Create: `scripts/platform/check-overlay.sh`, `scripts/platform/check-cashight-manifests.sh`
- Modify: `.github/workflows/platform-ci.yaml` (yaml job runs `check-cashight-manifests.sh`)

**Interfaces:**
- Consumes: the ServiceAccount names and role names from Task 1, `keda_scaler_role_arns` from Task 1, and `api_certificate_arn` from `terraform/v2`.
- Produces:
  - The Application `cashight` (namespace `argocd`, source `deploy/cashight/overlays/v2`, revision `cashight-v2`, destination namespace `cashight`, automated sync with prune and self-heal, `ServerSideApply=true`). Teardown deletes it by this name.
  - The overlay's `images:` entry named `cashight-backend`, which Task 4 rewrites with `kustomize edit set image cashight-backend=<repo>@<digest>`.
  - Services `cashight-api`, `cashight-api-canary`, `cashight-aws-api` and `cashight-aws-api-canary`, all on port 8080.
  - The Ingress `cashight`, with ALB group `cashight`.
  - `check-overlay.sh`: exit 0 when every value in `env.yaml` and `ingress.yaml` matches `terraform -chdir=terraform/v2 output -json` and `terraform -chdir=terraform/platform output -json`; otherwise exit 1 naming the key.

- [ ] **Step 1: Write the failing check script.** `check-cashight-manifests.sh` runs `kubectl kustomize deploy/cashight/overlays/v2`, pipes it through `kubeconform -strict -summary` (with the Argo Rollouts and KEDA CRD schemas from the datree catalog, `-ignore-missing-schemas` only for `AnalysisTemplate`), and asserts with `yq`:
  - Every container has `securityContext.runAsNonRoot: true`, `allowPrivilegeEscalation: false`, `readOnlyRootFilesystem: true`, `capabilities.drop: [ALL]` and `seccompProfile.type: RuntimeDefault`.
  - Every image matches `@sha256:`.
  - Every container has a memory request and limit, and the sum of `limits.memory` at maximum scale plus one surge pod per Rollout is `≤ 16Gi`.
  - The API NetworkPolicy ingress `ipBlock.cidr == "10.0.0.0/16"` on port 8080.
  - Egress allows TCP 443 to `0.0.0.0/0` and TCP 4318 to namespace `observability`.
  - Each `terminationGracePeriodSeconds` matches the sizing table.
- [ ] **Step 2: Run it to verify it fails.** Run: `bash scripts/platform/check-cashight-manifests.sh`. Expected: FAIL, `deploy/cashight/overlays/v2` not found.
- [ ] **Step 3: Write the base.**
  - **Rollouts:** canary strategy with `canaryService` and `stableService`, and no `trafficRouting`, because a replica-based canary is enough for a test environment. Steps: `setWeight: 10` → `analysis: {templates: [{templateName: smoke}]}` → `setWeight: 50` → `analysis` (same) → full. With 2 replicas the first step rounds up to 1 pod; record that in a comment.
  - **Probes:** liveness `/healthz`, readiness `/readyz`.
  - **Pod settings:** `automountServiceAccountToken: true` (Pod Identity needs it), `topologySpreadConstraints` across `topology.kubernetes.io/zone`, and an `emptyDir` at `/tmp`.
  - **`smoke-analysis.yaml`:** an `AnalysisTemplate` named `smoke` with arg `service`. Its `job` provider runs `curlimages/curl@sha256:<pinned>` and fails unless `http://{{args.service}}:8080/readyz` and `/health` answer 200. Each Rollout passes its own canary Service name.
  - **Workers:** Deployments with `replicas: 0` and no ports. Each ScaledObject uses an `aws-sqs-queue` trigger (`queueLength: "1"`, `awsRegion: ap-southeast-1`) and a `TriggerAuthentication` with `podIdentity: {provider: aws, roleArn: <scaler role ARN>}`, `minReplicaCount: 0`, and `maxReplicaCount` 2 or 1.
  - **Container args:** per `docs/container-runtime.md`.
- [ ] **Step 4: Write the v2 overlay.**
  - **`env.yaml`:** a ConfigMap with every non-secret variable from Global Constraints, using the real values from `terraform -chdir=terraform/v2 output` and the repo variables `COGNITO_USER_POOL_ID`, `COGNITO_SPA_CLIENT_ID` and `COGNITO_SMOKE_CLIENT_ID`. Per-workload values (`QUEUE_URL`, `MAX_PROCESSING_SECONDS`) are patches, not shared keys.
  - **`ingress.yaml`:** `ingressClassName: alb`, plus these annotations:
    - `alb.ingress.kubernetes.io/scheme: internet-facing`
    - `target-type: ip`
    - `group.name: cashight`
    - `listen-ports: '[{"HTTP":80},{"HTTPS":443}]'`
    - `ssl-redirect: '443'`
    - `certificate-arn: <api_certificate_arn>`
    - `healthcheck-path: /readyz`
  - **Ingress rules:** host `api.cashight-v2.nghuy.link`, path `/aws` (Prefix) → `cashight-aws-api`, path `/` → `cashight-api`.
  - **`kustomization.yaml`:** `images: [{name: cashight-backend, newName: <ecr_repository_url>, digest: sha256:0000…}]`. The all-zero digest is the "not built yet" marker that bring-up refuses (Task 5).
- [ ] **Step 5: Write `deploy/workloads/cashight.yaml`,** a plain `Application` as in Produces. Its `repoURL` is the CodeConnections URL from `terraform -chdir=terraform/platform output -raw gitops_repo_url`, written literally. `check-deploy-paths.sh` already allows `deploy/cashight`.
- [ ] **Step 6: Write `check-overlay.sh`** as in Produces. It reads the outputs with `jq` and compares each committed value exactly.
- [ ] **Step 7: Run the checks.** Run: `bash scripts/platform/check-cashight-manifests.sh && bash scripts/platform/check-deploy-paths.sh && yamllint deploy/`. Expected: PASS. (`check-overlay.sh` needs live state and runs in Task 6.)
- [ ] **Step 8: Wire the yaml job and commit.** Add `bash scripts/platform/check-cashight-manifests.sh` to the `yaml` job in `platform-ci.yaml`. Then run `git commit -m "feat(deploy): add the Cashight v2 manifests and Argo CD Application"`.

### Task 4: Image and SPA release workflow

**Files:**
- Create: `.github/workflows/v2-release.yaml`
- Create: `scripts/platform/pin-image.sh`
- Test: `scripts/__tests__/pin-image.test.ts` (vitest, calls the script against a temp copy of the overlay)

**Interfaces:**
- Consumes: the overlay `images:` entry `cashight-backend` (Task 3), and the `terraform/v2` outputs `ecr_repository_url`, `github_ci_role_arn`, `frontend_bucket_name` and `cloudfront_distribution_id`, stored as repository variables `V2_ECR_REPOSITORY_URL`, `V2_CI_ROLE_ARN`, `V2_FRONTEND_BUCKET` and `V2_CLOUDFRONT_DISTRIBUTION_ID`.
- Produces: `pin-image.sh <overlay-dir> <repo-url> <sha256:digest>` rewrites the image entry and exits 1 when the digest does not match `^sha256:[0-9a-f]{64}$`.

- [ ] **Step 1: Write the failing test.** `pins a valid digest` checks that the overlay's `images[0].digest` equals the input and `newName` equals the repo URL. `rejects a tag or a short digest` checks that `latest` and `sha256:abc` exit 1 and leave the file unchanged.
- [ ] **Step 2: Run it to verify it fails.** Run: `pnpm test scripts/__tests__/pin-image.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `pin-image.sh`** with `kustomize edit set image cashight-backend=<repo>@<digest>`, run inside the overlay directory.
- [ ] **Step 4: Run the test.** Expected: PASS.
- [ ] **Step 5: Write the workflow.**
  - **Trigger:** `on: push` to `cashight-v2` (paths `backend/**`, `packages/**`, `frontend/**`, `app/**`, `components/**`, `lib/**`, `Dockerfile`, `package.json`, `pnpm-lock.yaml`), plus `workflow_dispatch`.
  - **Settings:** `concurrency: {group: v2-release, cancel-in-progress: false}`, `permissions: {id-token: write, contents: write}`. No `environment:` on any job.
  - **Job `image`** (`runs-on: ubuntu-24.04-arm`):
    1. Assume `vars.V2_CI_ROLE_ARN`, log in to ECR, then `docker build` and push `cashight-backend:${{ github.sha }}`. Read the pushed digest from `docker inspect --format '{{index .RepoDigests 0}}'`.
    2. `git pull --rebase origin cashight-v2`, then `pin-image.sh`, then commit `chore(deploy): pin cashight-backend ${{ github.sha }}` as `github-actions[bot]`, then push.
    3. Retry the rebase and push once on a non-fast-forward.
    4. A push made with `GITHUB_TOKEN` starts no new workflow run, so the bot commit cannot loop.
  - **Job `spa`** (`ubuntu-latest`):
    1. `pnpm build` with `NEXT_PUBLIC_API_BASE_URL=https://api.cashight-v2.nghuy.link`, `NEXT_PUBLIC_APP_ORIGIN=https://cashight-v2.nghuy.link`, and the same Cognito and feature-flag variables as `application-deploy.yaml`.
    2. Run `node scripts/verify-static-export.mjs`.
    3. Run `node scripts/deploy-frontend.mjs` with `FRONTEND_BUCKET=${{ vars.V2_FRONTEND_BUCKET }}` and `CLOUDFRONT_DISTRIBUTION_ID=${{ vars.V2_CLOUDFRONT_DISTRIBUTION_ID }}`.
- [ ] **Step 6: Lint the workflow and commit.** Run: `actionlint .github/workflows/v2-release.yaml`. Expected: no findings. Then run `git commit -m "ci(v2): build the arm64 image, pin its digest and deploy the v2 SPA"`.

### Task 5: Bring-up and teardown scripts

**Files:**
- Create: `scripts/platform/bring-up.sh`, `scripts/platform/teardown.sh`
- Modify: `scripts/platform/destroy-platform.sh` (only if teardown needs a flag it lacks; otherwise unchanged)
- Test: `scripts/platform/tests/bring-up.bats` (or `scripts/__tests__/platform-scripts.test.ts` if bats is not installed in CI), using stubbed `terraform`, `kubectl`, `aws` and `pnpm` on `PATH`

**Interfaces:**
- Consumes: `check-overlay.sh` (Task 3), the Application name `cashight` (Task 3), `api_alb_ready` (Task 2), `scripts/v2/seed-authz.ts`, `scripts/smoke-serverless.mjs`, `scripts/platform/destroy-platform.sh` (argument `"destroy platform"`), and `terraform/grafana` variables `api_live` and `collector_live`.
- Produces:
  - `bring-up.sh`, which takes no arguments and exits 0 only when smoke passed.
  - `teardown.sh "destroy cashight-v2"`, which refuses without the literal argument.

- [ ] **Step 1: Write the failing tests.**
  - `bring-up refuses the placeholder digest`: the overlay digest is all zeros, so the script exits 1 before any `terraform apply` call.
  - `bring-up applies in order`: the recorded stub calls run in this order:
    1. `seed-authz --dry-run`, then `seed-authz`
    2. `terraform apply -target=module.platform_cluster`
    3. `terraform apply` with `enable_argocd=true`
    4. wait for Application `cashight` Healthy
    5. `terraform apply -var api_alb_ready=true`
    6. `check-overlay.sh`
    7. smoke
    8. grafana apply `-var api_live=true -var collector_live=true`
  - `teardown flips Grafana first, then deletes the app, then waits, then destroys`: the order is grafana `false`, then `kubectl delete application cashight -n argocd --cascade=foreground`, then the wait loop, then `destroy-platform.sh "destroy platform"`.
  - `teardown stops when a cashight load balancer survives the wait`: `aws elbv2 describe-load-balancers` keeps returning `k8s-cashight-…`, so the script exits 1 naming it and `destroy-platform.sh` is never called.
- [ ] **Step 2: Run them to verify they fail.** Expected: FAIL, scripts missing.
- [ ] **Step 3: Implement both scripts.**
  - Use `set -euo pipefail`. Every wait has a timeout: 20 min for the cluster, 15 min for the Application, 10 min for the ALB to disappear.
  - Smoke runs `node scripts/smoke-serverless.mjs` with `APP_URL=https://cashight-v2.nghuy.link`, `API_URL=https://api.cashight-v2.nghuy.link` and a token minted the same way as `application-deploy.yaml` (client credentials on the smoke client). Mask the token, and never echo it.
  - Wait for DNS before smoke: `dig +short api.cashight-v2.nghuy.link` must be non-empty and `/health` must answer 200 within 5 min.
- [ ] **Step 4: Run the tests and shellcheck.** Run: `pnpm test scripts/__tests__/platform-scripts.test.ts && shellcheck scripts/platform/*.sh`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(platform): one-command bring-up and teardown for the v2 test day"`

### Task 6: Docs and the first live test day

**Files:**
- Modify: `docs/platform.md` (new sections "Test day: bring-up" and "Test day: teardown"), `docs/v2-resources.md` (§4: list the repository variables Task 4 needs), `CLAUDE.md` (Commands table: bring-up and teardown), `terraform/grafana/metrics.tf` (confirmed Kubernetes metric names)
- Modify: this plan (record the live run results under "Execution record")

**Interfaces:**
- Consumes: everything above. This task is the acceptance run. It is done with the human at the workstation, not by a subagent.

- [ ] **Step 1: Set repository variables** `V2_ECR_REPOSITORY_URL`, `V2_CI_ROLE_ARN`, `V2_FRONTEND_BUCKET` and `V2_CLOUDFRONT_DISTRIBUTION_ID` from `terraform -chdir=terraform/v2 output`.
- [ ] **Step 2: Merge Tasks 1–5 into `cashight-v2`,** and confirm `v2-release` pinned a real digest and deployed the SPA. Expected: `curl -sI https://cashight-v2.nghuy.link | head -1` answers `HTTP/2 200`.
- [ ] **Step 3: Run `bash scripts/platform/bring-up.sh`.** Expected: exit 0, with smoke `PASS`.
- [ ] **Step 4: Plan 3 handover checks** (copy the results into the execution record):
  1. Confirm the `unverified until Plan 4` metric names in Grafana Explore, fix any that differ, and re-apply `terraform/grafana`.
  2. The collector Application is Synced and Healthy, and `scripts/platform/verify-platform.sh` passes.
  3. kubeletstats, k8s_cluster and pod logs arrive. The collector's own logs do not.
  4. Rule 5 fires: `kubectl -n cashight run crashloop --image=busybox@sha256:<pinned> --restart=Always -- sh -c 'exit 1'` (with a restricted securityContext). Delete it afterwards.
  5. Rule 1 fires and resolves: scale `cashight-api` to 0 for 5 min, then back.
- [ ] **Step 5: Exercise the app on `https://cashight-v2.nghuy.link`.** Sign in, upload the TPBank and VIB sample PDFs, and confirm that KEDA scales `parser-worker` from 0 and the dashboard shows the CLAUDE.md fixture totals. Then upload one AWS invoice. Also trigger one image release during the session and watch the canary pass both smoke analyses.
- [ ] **Step 6: Run `bash scripts/platform/teardown.sh "destroy cashight-v2"`.** Expected: exit 0. `aws eks list-clusters` is empty, no `k8s-cashight-*` load balancer remains, `dig +short api.cashight-v2.nghuy.link` is empty, and the `terraform/v2` resources are still present.
- [ ] **Step 7: Update the docs and commit.** `git commit -m "docs(platform): document the v2 test day and record the first run"`

## Execution record

_Filled in during Task 6._
