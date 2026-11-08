# Cashight v2 minimal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the v2 app all the time on EKS Fargate (cluster `cashight-v2-min`) for about $165–175/month. That means one merged API pod, Lambda parse workers, AI summaries switched off, and a GitHub Actions deploy that proves health and rolls back when a check fails.

**Architecture:** A new persistent Terraform root, `terraform/v2-minimal`, uses a new module, `terraform/modules/platform_cluster_fargate`. Together they create the VPC (one NAT gateway, S3 and DynamoDB gateway endpoints), a Fargate-only EKS cluster, Fargate logging, the AWS Load Balancer Controller (Helm), the IRSA role for the API, both worker Lambdas and the `api.cashight-v2` record. The data stores, edge, ECR and CI role still come from `terraform/v2` through `terraform_remote_state`. A self-contained Kustomize overlay, `deploy/cashight/overlays/v2-minimal`, runs one `Deployment cashight-api` with a merged entrypoint. `.github/workflows/v2-minimal-release.yaml` applies it with `kubectl` and gates the release on rollout status, the `/health` revision and the smoke suite. A failed check triggers `rollout undo` and moves the Lambda aliases back.

**Tech Stack:** Terraform ≥ 1.11 (AWS `~> 6.0`, kubernetes `~> 3.0`, helm `~> 3.0`, `terraform-aws-modules/vpc ~> 6.0`, `terraform-aws-modules/eks ~> 21.0`, `terraform test` with mock providers), EKS Fargate + IRSA, AWS Load Balancer Controller Helm chart 1.14.x, Lambda `nodejs22.x` arm64, Kustomize/kubectl, kubeconform, GitHub Actions, Node 24, vitest.

**Spec:** `docs/superpowers/specs/2026-11-08-cashight-v2-minimal-design.md`. Prior art to copy patterns from: Plan 4c (`docs/superpowers/plans/2026-11-08-eks-migration-04c-ephemeral-bring-up.md`), `terraform/platform/workloads.tf`, and `terraform/compute.tf` (v1 Lambdas).

## Global Constraints

- **v1 is untouched.** No change to the v1 root (`terraform/*.tf`), the v1 workflows or any v1 resource. The SSM parameter `/cashight/prod/gemini-api-key` stays.
- **The full ephemeral v2 is untouched in behaviour.** Do not edit `terraform/platform`, `terraform/modules/platform_cluster`, `deploy/platform` or `deploy/cashight/{base,overlays/v2}`. `terraform -chdir=terraform/platform test` must pass unchanged. Allowed edits there: `scripts/platform/bring-up.sh` (mutual-exclusion guard and the shared token script) and `.github/workflows/v2-release.yaml` (`V2_TARGET` gate).
- **Branching:** branch from `cashight-v2`, PR into `cashight-v2`.
- **Roots are applied from the workstation only.** CI runs `fmt`, `validate`, `test`, TFLint and Checkov, never `plan` or `apply`. State: bucket `cashight-tfstate`, key `cashight/v2-minimal/terraform.tfstate`, KMS `alias/cashight-tfstate`, `use_lockfile = true`.
- **Region `ap-southeast-1`.** All images and Lambdas are arm64.
- **Names:** cluster `cashight-v2-min`. Namespace `cashight`. Deployment, ServiceAccount and Service `cashight-api`. Ingress `cashight` with ALB group `cashight`. Log group `/cashight/v2-min/app`. Lambdas `cashight-v2-parser-worker` and `cashight-v2-invoice-parser-worker`, each with alias `live`. IAM roles are prefixed `cashight-v2-min-`.
- **Tags:** `Environment = v2-minimal`, `Project = cashight`, `ManagedBy = Terraform`, set through the AWS provider's `default_tags`.
- **The v2 CI role trusts exactly `repo:HuyNguyen260398/cashight:ref:refs/heads/cashight-v2`.** No job that assumes it may set `environment:`.
- **No EC2 the project manages:** no `aws_eks_node_group`, `aws_instance`, `aws_eks_capability` or interface VPC endpoint, and exactly one `aws_nat_gateway`.
- **Standard support only:** `upgrade_policy { support_type = "STANDARD" }`.
- **Fargate sizing:** `cashight-api` requests and limits are `cpu: 250m`, `memory: 768Mi`. The LBC requests `250m/256Mi`. CoreDNS keeps its add-on defaults. Lambda settings: parser 1536 MB / 120 s / reserved 2; invoice parser 2048 MB / 300 s / reserved 1. Both get 1024 MB ephemeral storage.
- **AI summary flag:** the server reads `AI_SUMMARY_ENABLED`, which is disabled only when the value is exactly `false`. The SPA reads `NEXT_PUBLIC_ENABLE_AI_SUMMARY`, also disabled only when exactly `false`. Both default to enabled, so v1 and the full v2 are unchanged.
- **Secrets stay in SSM** (`PDF_PASSWORD_PARAM=/cashight/prod/pdf-password`). PCI and AI-payload conventions in `CLAUDE.md` apply unchanged.
- **Deployment selector:** the deploy target is chosen by the repository variable `V2_TARGET` (`full` | `minimal`, unset means `full`). Only the matching release workflow deploys the image and SPA.

## Review Focus

1. **A config-only release that does not restart the pod.** A ConfigMap change with the same image digest leaves the old pod running with stale env, yet the `/health` hash check still passes. Expected: every release sets the pod-template annotation `cashight.nghuy.link/app-version: <sha>`, so each commit produces a new ReplicaSet. Pinned in Task 8 (manifest check) and Task 9 (workflow test).
2. **`/health` answered by the old pod during the rolling update.** The ALB needs time to register the new target and drain the old one. Expected: the revision check retries for up to 180 s until `/health` returns the new `pod-template-hash`, then fails. A single curl is not enough. Pinned in Task 9 (`scripts/v2-minimal/wait-revision.sh` tests).
3. **Rollback when nothing exists to roll back to.** On the first deploy there is no previous ReplicaSet and no previous Lambda version. Expected: rollback skips `rollout undo` and alias restores that have no earlier revision, says so in the job log, and still fails the job. It never errors out before failing. Pinned in Task 9 (`rollback.sh` tests).
4. **Both release workflows deploying the SPA to the same bucket.** `v2-release.yaml` would redeploy the SPA with summaries on. Expected: with `V2_TARGET=minimal`, `v2-release.yaml` skips every job and only the minimal workflow runs, and the reverse for any other value. Pinned in Task 9 (workflow tests on both files).
5. **Lambda aliases moved while the API check fails.** Workers are updated before the API smoke test. Expected: rollback points each `live` alias back at the version recorded before the release, even when only one alias had moved. Pinned in Task 9 (`rollback.sh` tests).

---

### Task 1: Server-side AI summary switch and the merged API entrypoint

**Files:**
- Modify: `backend/shared/config.ts` (add `aiSummaryEnabled`)
- Create: `backend/server/api-all-service.ts`, `backend/server/entrypoints/api-all.ts`
- Modify: `scripts/build-servers.mjs` (add `{ name: 'api-all', needsPdfWorker: false }`), `scripts/__tests__/build-servers.test.mjs`
- Modify: `backend/server/start-api.ts:32-33`, `backend/server/http-server.ts:42` (comments only: the hash now comes from either `rollouts-pod-template-hash` or `pod-template-hash`)
- Modify: `docs/container-runtime.md` (route table and required-config rows for `/app/api-all/index.js`)
- Test: `backend/__tests__/api-all-service.test.ts`

**Interfaces:**
- Produces:
  - `aiSummaryEnabled(env?: Record<string, string | undefined>): boolean` in `backend/shared/config.ts`.
  - `apiAllService(env?: Record<string, string | undefined>): { handlers: Partial<Record<HandlerName, ApiHandler>>; requiredEnv: readonly string[] }` in `backend/server/api-all-service.ts`.
  - Container argument `/app/api-all/index.js`, which calls `startApiService('cashight-api', ...)`.

- [ ] **Step 1: Write the failing tests** in `backend/__tests__/api-all-service.test.ts`:
  - `aiSummaryEnabled({})` and `aiSummaryEnabled({ AI_SUMMARY_ENABLED: 'true' })` and `aiSummaryEnabled({ AI_SUMMARY_ENABLED: 'FALSE' })` are `true`. `aiSummaryEnabled({ AI_SUMMARY_ENABLED: 'false' })` is `false`.
  - `Object.keys(apiAllService({}).handlers).sort()` equals all nine `HandlerName`s, and `requiredEnv` equals `['TABLE_NAME','STATEMENTS_BUCKET','UPLOAD_BUCKET','EXPORT_BUCKET','GEMINI_PARAM']`.
  - With `{ AI_SUMMARY_ENABLED: 'false' }`, the handlers exclude `summaries` and `awsInvoiceSummaries` (seven remain) and `requiredEnv` does not contain `GEMINI_PARAM`.
  - Through `createApiServer` with the disabled handler set, an authenticated `POST /summaries` and `POST /aws/invoices/summary` answer **404**. Reuse the verifier stub pattern from `backend/__tests__/server-http.test.ts`.
  - In `scripts/__tests__/build-servers.test.mjs`, the expected names become `['api', 'api-all', 'aws-api', 'invoice-parser-worker', 'parser-worker']`, and `api-all` ships no `pdf.worker.mjs`.
- [ ] **Step 2: Run them to verify they fail.** Run: `pnpm test backend/__tests__/api-all-service.test.ts scripts/__tests__/build-servers.test.mjs`. Expected: FAIL (module not found, and the name list differs).
- [ ] **Step 3: Implement.** `apiAllService` imports the nine handlers already imported by `entrypoints/api.ts` and `entrypoints/aws-api.ts`, and drops the two summary handlers and `GEMINI_PARAM` when `aiSummaryEnabled(env)` is false. `entrypoints/api-all.ts` mirrors `entrypoints/api.ts`: `const { handlers, requiredEnv } = apiAllService(); startApiService('cashight-api', handlers, requiredEnv)`, using the same `.catch`. Leave `api.ts` and `aws-api.ts` untouched.
- [ ] **Step 4: Run the tests, type check and lint.** Run: `pnpm test && pnpm tsc --noEmit && pnpm lint && pnpm build:servers && ls dist/servers/api-all/index.js`. Expected: PASS, and the file exists.
- [ ] **Step 5: Commit.** `git commit -m "feat(server): add the merged api-all entrypoint and the AI_SUMMARY_ENABLED switch"`

### Task 2: SPA AI summary flag

**Files:**
- Modify: `frontend/config/features.ts` (add `isAiSummaryEnabled`)
- Modify: `app/components/dashboard.tsx:20`, `app/components/aws-invoices/aws-invoice-dashboard.tsx:138`
- Test: `frontend/__tests__/feature-flags.test.ts`, `app/__tests__/aws-invoice-dashboard.test.tsx`, plus a dashboard render test next to the existing dashboard tests (create `app/__tests__/dashboard-ai-summary.test.tsx` if none renders `<Dashboard>`)

**Interfaces:**
- Produces: `isAiSummaryEnabled(): boolean`, which returns `process.env.NEXT_PUBLIC_ENABLE_AI_SUMMARY !== 'false'`. The build-time flag was chosen over `/session/capabilities` because it needs no API round-trip and no schema change.

- [ ] **Step 1: Write the failing tests.**
  - `feature-flags.test.ts`: the flag is enabled for `''`, `'true'` and `'FALSE'`, and disabled only for `'false'`.
  - Dashboard: with `vi.stubEnv('NEXT_PUBLIC_ENABLE_AI_SUMMARY','false')`, rendering `<Dashboard>` shows no AI summary card (query the card's heading or test id). Unstubbed, it does show the card.
  - `aws-invoice-dashboard.test.tsx`: with the flag `'false'`, `[data-dashboard-panel="ai"]` is absent. By default it is present.
- [ ] **Step 2: Run them to verify they fail.** Run: `pnpm test frontend/__tests__/feature-flags.test.ts app/__tests__`. Expected: FAIL.
- [ ] **Step 3: Implement.** Wrap each component (and, for the invoice dashboard, its `RevealPanel`) in `isAiSummaryEnabled() && …`. Do not delete either component.
- [ ] **Step 4: Run the tests and lint.** Run: `pnpm test && pnpm tsc --noEmit && pnpm lint`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(spa): hide AI summaries when NEXT_PUBLIC_ENABLE_AI_SUMMARY=false"`

### Task 3: Smoke check that summaries are disabled

**Files:**
- Modify: `scripts/smoke-serverless.mjs` (new env `SMOKE_EXPECT_AI_SUMMARY_DISABLED`, documented in the header comment)
- Test: `scripts/__tests__/smoke-serverless.test.mjs`

**Interfaces:**
- Produces: when `SMOKE_EXPECT_AI_SUMMARY_DISABLED=true` and a native token is set, two checks run: `POST /summaries returns 404 (AI summary disabled)` and `POST /aws/invoices/summary returns 404 (AI summary disabled)`. Each sends a body of `{}`. When the variable is unset, neither check runs.

- [ ] **Step 1: Write the failing tests,** following the existing fetch-stub pattern in the test file. The flag set with a 404 stub passes. The flag set with a 200 stub fails, naming the check. Without the flag, no request goes to either path.
- [ ] **Step 2: Run them to verify they fail.** Run: `pnpm test scripts/__tests__/smoke-serverless.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** the two checks with the existing `check()` helper, after the authenticated capabilities check.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "test(smoke): assert the summary routes answer 404 when AI summaries are disabled"`

### Task 4: Module `terraform/modules/platform_cluster_fargate`

**Files:**
- Create: `terraform/modules/platform_cluster_fargate/{versions.tf,variables.tf,vpc.tf,eks.tf,fargate.tf,iam_load_balancer_controller.tf,outputs.tf}`
- Reuse: `terraform/modules/platform_cluster/policies/aws-load-balancer-controller.json`, referenced by a relative path and not copied
- Test: covered through the root in Task 5 (`terraform/v2-minimal/tests/`)

**Interfaces:**
- Consumes: variables `cluster_name` (string), `vpc_cidr` (string, default `10.1.0.0/16` so it never overlaps the full platform's `10.0.0.0/16`), `kubernetes_version` (string), `admin_principal_arns` (list(string)), `ci_role_arn` (string), `fargate_log_policy_json` (string), `tags` (map(string)).
- Produces outputs: `cluster_name`, `cluster_arn`, `cluster_endpoint`, `cluster_certificate_authority_data`, `oidc_provider_arn`, `oidc_issuer` (without `https://`), `vpc_id`, `private_subnet_ids`, `public_subnet_ids`, `load_balancer_controller_role_arn`.

- [ ] **Step 1: VPC (`vpc.tf`).** Use `terraform-aws-modules/vpc/aws ~> 6.0` with 2 AZs and public plus private subnets, `enable_nat_gateway = true`, `single_nat_gateway = true` and `one_nat_gateway_per_az = false`. Tag the public subnets `kubernetes.io/role/elb=1` and the private ones `kubernetes.io/role/internal-elb=1`. Add `aws_vpc_endpoint` resources of type `Gateway` for `s3` and `dynamodb` on the private route tables. Create no interface endpoints.
- [ ] **Step 2: Cluster (`eks.tf`).** Use `terraform-aws-modules/eks/aws ~> 21.0` with:
  - `authentication_mode = "API"`, public and private endpoints, `endpoint_public_access_cidrs = ["0.0.0.0/0"]` (spec §6.2: IAM plus access entries are the gate), and a comment saying so. `enable_irsa = true`.
  - `enabled_log_types = []` and `create_cloudwatch_log_group = false`. `create_kms_key = false` and `encryption_config = null`, so the AWS-owned key is used.
  - `upgrade_policy = { support_type = "STANDARD" }`.
  - `compute_config = { enabled = false }` and no `eks_managed_node_groups`.
  - Add-ons: only `coredns`, with `configuration_values = jsonencode({ computeType = "Fargate", replicaCount = 1 })`. Do not add vpc-cni, kube-proxy or eks-pod-identity-agent. Fargate supplies pod networking (verified live in Task 11, step 2).
  - `access_entries`: each `admin_principal_arns` entry gets `AmazonEKSClusterAdminPolicy` with cluster scope. `ci_role_arn` gets `arn:aws:eks::aws:cluster-access-policy/AmazonEKSEditPolicy` with `access_scope = { type = "namespace", namespaces = ["cashight"] }`. Set `enable_cluster_creator_admin_permissions = false`, so admin access is explicit.
- [ ] **Step 3: Fargate (`fargate.tf`).** Profiles `kube-system` (selector namespace `kube-system`) and `cashight` (namespace `cashight`) on the private subnets. Give them one shared pod execution role, `${cluster_name}-fargate-pod`, with `AmazonEKSFargatePodExecutionRolePolicy` plus an inline policy from `var.fargate_log_policy_json`.
- [ ] **Step 4: LBC IRSA role (`iam_load_balancer_controller.tf`).** Role `${cluster_name}-lbc`. Its trust is the OIDC provider with `sub = system:serviceaccount:kube-system:aws-load-balancer-controller` and `aud = sts.amazonaws.com`. Its policy is the shared JSON file.
- [ ] **Step 5: Validate.** Run: `terraform -chdir=terraform/modules/platform_cluster_fargate init -backend=false && terraform -chdir=terraform/modules/platform_cluster_fargate validate && terraform fmt -check -recursive terraform/modules/platform_cluster_fargate`. Expected: `Success!`, and fmt prints nothing.
- [ ] **Step 6: Commit.** `git commit -m "feat(v2-minimal): add the Fargate-only cluster module"`

### Task 5: Root `terraform/v2-minimal`: cluster, in-cluster bootstrap, API role, guard, DNS

**Files:**
- Create: `terraform/v2-minimal/{backend.tf,versions.tf,providers.tf,variables.tf,main.tf,kubernetes.tf,api_role.tf,dns.tf,outputs.tf,terraform.tfvars.example}`
- Create: `terraform/v2-minimal/tests/v2_minimal.tftest.hcl`
- Modify: `.github/workflows/platform-ci.yaml` (add `v2-minimal` to the `root` matrix and `terraform/v2-minimal/**` and `terraform/modules/platform_cluster_fargate/**` to `paths`)

**Interfaces:**
- Consumes:
  - From `terraform/v2` remote state: `table_arn`, `statements_bucket_arn`, `uploads_bucket_arn`, `cost_exports_bucket_arn`, `api_certificate_arn`, `github_ci_role_arn`.
  - From Task 4: the module outputs.
- Produces:
  - Variables `kubernetes_version` (default `"1.35"`) and `admin_principal_arns` (list(string)).
  - Outputs `cluster_name`, `api_role_arn`, `api_certificate_arn`, `log_group_name`, `parser_worker_function_name`, `invoice_parser_worker_function_name` (the last two come from Task 6).
  - Kubernetes namespaces `cashight` and `aws-observability`, `LimitRange cashight-defaults`, ConfigMap `aws-observability/aws-logging`, and the Helm release `aws-load-balancer-controller` in `kube-system`.

- [ ] **Step 1: Write the failing tests** in `tests/v2_minimal.tftest.hcl`. Use `mock_provider` for `aws`, `kubernetes` and `helm`, with `aws_iam_policy_document` mocked as in `terraform/v2/tests/ci.tftest.hcl`. Use `override_data` for `terraform_remote_state.v2` and for `data.aws_eks_clusters.all` (`names = []`). Add these `run` blocks (`command = plan`):
  - `no_ec2_and_one_nat`: `module.cluster.module.vpc.natgw_ids` has length 1, both `aws_vpc_endpoint` resources have `vpc_endpoint_type == "Gateway"`, and `length(module.cluster.module.eks.eks_managed_node_groups) == 0`.
  - `standard_support`: `module.cluster.module.eks.cluster_upgrade_policy` (or the resource's `upgrade_policy[0].support_type`, whichever the module exposes) equals `"STANDARD"`.
  - `extended_support_version_rejected`: `variables { kubernetes_version = "1.29" }` and `expect_failures = [var.kubernetes_version]`.
  - `refuses_while_full_cluster_exists`: override `data.aws_eks_clusters.all` with `names = ["cashight-v2"]`, `expect_failures = [terraform_data.exclusive_with_full_platform]`.
  - `api_role_has_no_gemini`: no statement sid in `local.api_statements` equals `GetGeminiKey`, the sid set equals the union of today's `api` and `aws-api` sids minus `GetGeminiKey`, and the trust condition `sub` is `system:serviceaccount:cashight:cashight-api`.
  - `dns_waits_for_alb`: with `data.aws_lbs.cashight` overridden to `arns = []`, `length(aws_route53_record.api) == 0`. With one ARN (and `data.aws_lb.cashight` overridden), both `A` and `AAAA` exist with name `api.cashight-v2.nghuy.link`.
  - `fargate_logging`: `kubernetes_config_map_v1.aws_logging.data["output.conf"]` contains `/cashight/v2-min/app`, and `filters.conf` contains `^cashight$`. `aws_cloudwatch_log_group.app.retention_in_days == 7`.
- [ ] **Step 2: Run them to verify they fail.** Run: `terraform -chdir=terraform/v2-minimal init -backend=false && terraform -chdir=terraform/v2-minimal test`. Expected: FAIL, configuration missing.
- [ ] **Step 3: Implement the root.**
  - `backend.tf` follows `terraform/platform/backend.tf` with key `cashight/v2-minimal/terraform.tfstate`.
  - `providers.tf`: `aws` with `default_tags`. `kubernetes` and `helm` use `exec` `aws eks get-token` against the module outputs, as `terraform/platform/providers.tf` does.
  - `variables.tf`: `kubernetes_version` validation `contains([...], var.kubernetes_version)`. The list holds the versions that `aws eks describe-cluster-versions --version-status STANDARD_SUPPORT --query 'clusterVersions[].clusterVersion'` returns on the day of implementation. Add a comment naming that command and telling the reader to refresh the list before an upgrade.
  - `main.tf`: `terraform_remote_state.v2`, `data "aws_eks_clusters" "all"`, and `terraform_data.exclusive_with_full_platform`. The latter has `lifecycle { precondition { condition = !contains(data.aws_eks_clusters.all.names, "cashight-v2"), error_message = "The full v2 cluster cashight-v2 exists; tear it down (scripts/platform/teardown.sh) before applying v2-minimal." } }`. The module call passes `depends_on = [terraform_data.exclusive_with_full_platform]`. Also create `aws_cloudwatch_log_group.app` (`/cashight/v2-min/app`, 7 days) and the `fargate_log_policy_json` document (`logs:CreateLogStream`, `logs:PutLogEvents`, `logs:DescribeLogStreams` on the group and `:*`).
  - `kubernetes.tf`:
    - Namespaces `cashight` and `aws-observability` (the latter labelled `aws-observability: enabled`).
    - `kubernetes_limit_range_v1` with default and defaultRequest `cpu: 250m, memory: 512Mi` and max `memory: 2Gi`.
    - ConfigMap `aws-logging`:
      - `flb_log_cw: "false"`.
      - `filters.conf`: a `kubernetes` filter (`Match kube.*`, `Merge_Log On`, `Buffer_Size 0`, `Kube_Meta_Cache_TTL 300s`), then `grep` with `Regex $kubernetes['namespace_name'] ^cashight$`, so only app logs ship (spec decision 3).
      - `output.conf`: `cloudwatch_logs`, `log_group_name /cashight/v2-min/app`, `log_stream_prefix fargate-`, `auto_create_group false`.
    - `helm_release.aws_load_balancer_controller` from repo `https://aws.github.io/eks-charts`, chart `aws-load-balancer-controller`, pinned `version`. Values: `clusterName`, `region`, `vpcId`, `replicaCount = 1`, `serviceAccount.annotations."eks.amazonaws.com/role-arn"`, `enableShield = false`, `enableWaf = false`, `enableWafv2 = false`, `resources.requests = { cpu = "250m", memory = "256Mi" }`, `resources.limits.memory = "256Mi"`.
  - `api_role.tf`: `local.api_statements` is the union of the `api` and `aws-api` statement lists from `terraform/platform/workloads.tf`, copied with a comment naming the source and **without** both `GetGeminiKey` entries. Role `cashight-v2-min-api` with an IRSA trust (`StringEquals` on `${oidc_issuer}:sub` and `:aud`).
  - `dns.tf`: `data "aws_lbs" "cashight"` with tags `elbv2.k8s.aws/cluster = cashight-v2-min` and `ingress.k8s.aws/stack = cashight`. `data "aws_lb" "cashight"` and `aws_route53_record.api` (`A` and `AAAA`, `for_each`) are created only when `length(data.aws_lbs.cashight.arns) == 1`. No manual flag: the record appears on the first apply after the first deploy.
- [ ] **Step 4: Run the tests, fmt, validate, TFLint and Checkov.** Run: `terraform -chdir=terraform/v2-minimal fmt -check -recursive && terraform -chdir=terraform/v2-minimal validate && terraform -chdir=terraform/v2-minimal test`, then the TFLint and Checkov commands from `platform-ci.yaml`. Expected: PASS. Each Checkov skip carries a one-line reason, e.g. `CKV_AWS_39` for the public endpoint (spec §6.2) and `CKV_AWS_37` for control-plane logging being off. Also run `terraform -chdir=terraform/platform test`. Expected: PASS, unchanged.
- [ ] **Step 5: Commit.** `git commit -m "feat(v2-minimal): add the always-on Fargate root"`

### Task 6: Worker Lambdas in `terraform/v2-minimal`

**Files:**
- Create: `terraform/v2-minimal/workers.tf`
- Modify: `terraform/v2-minimal/outputs.tf`
- Test: `terraform/v2-minimal/tests/v2_minimal.tftest.hcl`

**Interfaces:**
- Consumes: from `terraform/v2` remote state: `table_name`, `table_arn`, `uploads_bucket_name`, `uploads_bucket_arn`, `statements_bucket_name`, `statements_bucket_arn`, `parse_queue_arn`, `invoice_parse_queue_arn`.
- Produces: functions `cashight-v2-parser-worker` and `cashight-v2-invoice-parser-worker`, each with alias `live`. Event source mappings target the alias ARN. Log groups `/aws/lambda/<name>` keep logs for 7 days. Roles are `cashight-v2-min-parser-worker` and `cashight-v2-min-invoice-parser-worker`.

- [ ] **Step 1: Write the failing tests.** `run "workers"` asserts:
  - For both functions: `architectures == ["arm64"]` and `runtime == "nodejs22.x"`.
  - The parser has `memory_size = 1536`, `timeout = 120` and `reserved_concurrent_executions = 2`. The invoice parser has `2048`, `300` and `1`.
  - Both event source mappings have `batch_size == 1` and `function_response_types == ["ReportBatchItemFailures"]`, and `function_name` is the alias ARN.
  - Only the parser's environment has `PDF_PASSWORD_PARAM == "/cashight/prod/pdf-password"`. Neither has `ENABLE_LEGACY_WORKSPACE_FALLBACK` or `GEMINI_PARAM`.
  - Each log group's `retention_in_days == 7`.
  - The statement sid sets equal those of `parser-worker` and `invoice-parser-worker` in `terraform/platform/workloads.tf`, plus `Logs`.
- [ ] **Step 2: Run them to verify they fail.** Run: `terraform -chdir=terraform/v2-minimal test`. Expected: FAIL.
- [ ] **Step 3: Implement `workers.tf`.**
  - Follow `terraform/compute.tf:621-676` (`aws_lambda_function.parser_worker`, alias, ESM): `publish = true`, a placeholder `archive_file`, `lifecycle { ignore_changes = [filename, source_code_hash] }` on the function and `ignore_changes = [function_version]` on the alias, so Terraform never fights CI. Use `ephemeral_storage.size = 1024` and no `tracing_config`.
  - Environment: `TABLE_NAME`, `UPLOAD_BUCKET`, `STATEMENTS_BUCKET` and `STORAGE_REGION = "ap-southeast-1"` for both, plus `PDF_PASSWORD_PARAM` for the parser.
  - IAM: copy the two worker statement lists from `terraform/platform/workloads.tf` with a source comment. Add a `Logs` statement (`logs:CreateLogStream`, `logs:PutLogEvents`) on the function's own log group. The `sqs_consume` actions already cover the event source mapping.
  - Add a comment explaining why the queue visibility of 360 s is enough (≥ 300 s; spec §4.4).
- [ ] **Step 4: Run the tests, fmt, TFLint and Checkov.** Expected: PASS. Each Checkov skip for X-Ray, code signing, DLQ-on-function and VPC carries a one-line reason. The DLQs live on the queues.
- [ ] **Step 5: Commit.** `git commit -m "feat(v2-minimal): run the parse workers as SQS-triggered Lambdas"`

### Task 7: Additive changes in `terraform/v2` (CI role) and `terraform/platform-base` (budget)

**Files:**
- Modify: `terraform/v2/ci.tf`, `terraform/v2/tests/ci.tftest.hcl`
- Modify: `terraform/platform-base/budget.tf`, `terraform/platform-base/variables.tf` (or wherever its variables live), its tests

**Interfaces:**
- Produces:
  - CI role statement `EksDescribeMinimal`: `eks:DescribeCluster` on `arn:aws:eks:ap-southeast-1:<account>:cluster/cashight-v2-min`.
  - CI role statement `DeployMinimalWorkers`: `lambda:UpdateFunctionCode`, `lambda:PublishVersion`, `lambda:GetFunction`, `lambda:GetFunctionConfiguration`, `lambda:GetAlias`, `lambda:UpdateAlias` on `arn:aws:lambda:ap-southeast-1:<account>:function:cashight-v2-parser-worker` and `cashight-v2-invoice-parser-worker`, each with and without `:*`.
  - In `terraform/platform-base`: variable `enable_v2_minimal_budget` (bool, default `false`), plus `aws_ce_cost_allocation_tag.environment` (`tag_key = "Environment"`, `status = "Active"`) and `aws_budgets_budget.v2_minimal`, both `count`-gated by that variable. The budget is $200 a month, with `cost_filter { name = "TagKeyValue", values = ["user:Environment$v2-minimal"] }` and ACTUAL notifications at 80 % and 100 % to `var.budget_notification_emails`.

- [ ] **Step 1: Write the failing tests.**
  - `ci.tftest.hcl`: the CI policy document's statement sids include both new sids, and `DeployMinimalWorkers`' resources mention only the two function names. Use argument-level asserts, as the file already does.
  - platform-base: `length(aws_budgets_budget.v2_minimal) == 0` by default. With `enable_v2_minimal_budget = true`, `limit_amount == "200"`, two notifications, and the `TagKeyValue` filter.
- [ ] **Step 2: Run them to verify they fail.** Run: `terraform -chdir=terraform/v2 test && terraform -chdir=terraform/platform-base test`. Expected: FAIL.
- [ ] **Step 3: Implement.** Add a comment on the budget: the tag only becomes filterable about a day after first billed usage, so set `enable_v2_minimal_budget = true` after go-live (docs, Task 10).
- [ ] **Step 4: Run the tests, fmt and validate for both roots.** Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(v2): let CI deploy v2-minimal and budget it by tag"`

### Task 8: Overlay `deploy/cashight/overlays/v2-minimal`

**Files:**
- Create: `deploy/cashight/overlays/v2-minimal/{kustomization.yaml,serviceaccount.yaml,deployment.yaml,service.yaml,ingress.yaml,env.yaml}`. This is a self-contained slim base and does not reference `../../base`.
- Create: `scripts/platform/check-minimal-manifests.sh`
- Modify: `.github/workflows/platform-ci.yaml` (yaml job runs the new script, and its paths include the overlay)
- Modify: `scripts/platform/check-deploy-paths.sh` only if it rejects the new directory

**Interfaces:**
- Consumes: from Task 5, `api_role_arn`, `api_certificate_arn` and the namespace `cashight`, which Terraform owns, so the overlay has no Namespace object. From Task 1, `/app/api-all/index.js`.
- Produces:
  - The kustomization has `namespace: cashight` and an `images:` entry `cashight-backend`, which `scripts/platform/pin-image.sh` rewrites in the runner.
  - `env.yaml` holds `ConfigMap cashight-env` with a `data.APP_VERSION` key, which pin-image also rewrites.
  - In `deployment.yaml`, the pod-template annotation `cashight.nghuy.link/app-version` is set per release by Task 9.

- [ ] **Step 1: Write the failing check script.** `check-minimal-manifests.sh` renders `kubectl kustomize deploy/cashight/overlays/v2-minimal`, runs `kubeconform -strict -summary` (built-in schemas only), and asserts with `yq`/`jq`, printing one `FAIL:` line per problem as `check-cashight-manifests.sh` does. It asserts:
  - The kinds are exactly `{ServiceAccount, ConfigMap, Deployment, Service, Ingress}`. No Rollout, ScaledObject, NetworkPolicy or PodDisruptionBudget.
  - The Deployment has `replicas: 1`, `strategy.rollingUpdate` set to `{maxSurge: 1, maxUnavailable: 0}`, `revisionHistoryLimit: 3`, container `args == ["/app/api-all/index.js"]`, requests and limits of `cpu 250m` and `memory 768Mi`, probes `/healthz` and `/readyz`, and the annotation `cashight.nghuy.link/app-version` present.
  - The env var `POD_TEMPLATE_HASH` comes from `fieldRef.fieldPath: metadata.labels['pod-template-hash']`.
  - Pod Security restricted settings, as in the existing script: `runAsNonRoot`, `allowPrivilegeEscalation: false`, `readOnlyRootFilesystem: true`, drop `ALL`, `RuntimeDefault`. A `/tmp` emptyDir is mounted.
  - The image matches `@sha256:`.
  - The ServiceAccount annotation `eks.amazonaws.com/role-arn` matches `^arn:aws:iam::\d{12}:role/cashight-v2-min-api$`.
  - The ConfigMap has `AI_SUMMARY_ENABLED: "false"` and none of the keys `GEMINI_PARAM`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `PARSE_QUEUE_URL`, `INVOICE_PARSE_QUEUE_URL`. It does contain `EXPORT_BUCKET`.
  - The Ingress has a single rule path `/` → `cashight-api`, host `api.cashight-v2.nghuy.link`, annotations `target-type: ip`, `scheme: internet-facing`, `group.name: cashight`, `healthcheck-path: /readyz`, and a certificate ARN.
- [ ] **Step 2: Run it to verify it fails.** Run: `bash scripts/platform/check-minimal-manifests.sh`. Expected: FAIL, overlay not found.
- [ ] **Step 3: Write the manifests.** Base them on `deploy/cashight/base/api-rollout.yaml`'s pod spec (security context, probes, `terminationGracePeriodSeconds: 45`, `tmp` volume) and on `overlays/v2/{env,ingress}.yaml`, with the spec §4.3 differences. Drop `topologySpreadConstraints`. Keep `automountServiceAccountToken: true`, which IRSA needs.
- [ ] **Step 4: Run the check and the existing checks.** Run: `bash scripts/platform/check-minimal-manifests.sh && bash scripts/platform/check-cashight-manifests.sh && bash scripts/platform/check-deploy-paths.sh`. Expected: all PASS. The full overlay renders unchanged: `git diff --exit-code deploy/cashight/base deploy/cashight/overlays/v2`.
- [ ] **Step 5: Commit.** `git commit -m "feat(deploy): add the v2-minimal overlay"`

### Task 9: Release workflow with health gate and rollback

**Files:**
- Create: `.github/workflows/v2-minimal-release.yaml`
- Create: `scripts/v2-minimal/deploy-workers.sh`, `scripts/v2-minimal/wait-revision.sh`, `scripts/v2-minimal/rollback.sh`, `scripts/platform/mint-smoke-token.sh`
- Modify: `scripts/platform/bring-up.sh` (replace the inline token block at lines 121–138 with `token=$(bash scripts/platform/mint-smoke-token.sh)`)
- Modify: `.github/workflows/v2-release.yaml` (add `if: vars.V2_TARGET != 'minimal'` on both jobs)
- Test: `scripts/__tests__/v2-minimal-release.test.ts` (workflow YAML and the three scripts with stub CLIs on `PATH`, following `scripts/__tests__/platform-scripts.test.ts`), `scripts/__tests__/v2-release-workflow.test.ts`, `scripts/__tests__/platform-scripts.test.ts`

**Interfaces:**
- Consumes:
  - From Task 8: the overlay and the `app-version` annotation.
  - From Task 6: the function names and the `live` aliases.
  - From Task 3: `SMOKE_EXPECT_AI_SUMMARY_DISABLED`.
  - Repo variables: `V2_TARGET`, `V2_CI_ROLE_ARN`, `V2_ECR_REPOSITORY_URL`, `V2_FRONTEND_BUCKET`, `V2_CLOUDFRONT_DISTRIBUTION_ID`, `COGNITO_*`.
- Produces:
  - `mint-smoke-token.sh` prints an access token on stdout. It reads `COGNITO_USER_POOL_ID`, `COGNITO_SMOKE_CLIENT_ID` and `COGNITO_HOSTED_UI_DOMAIN` from the environment, falling back to `gh variable get`. It never prints the secret, and exits 1 with the OAuth error code on failure.
  - `deploy-workers.sh <dist-lambdas-dir> <state-file>` first writes `<function>=<previous live version>` lines to the state file for both functions. Then, for each function, it zips, runs `update-function-code --zip-file --publish`, waits for `function-updated`, and runs `update-alias live`.
  - `rollback.sh <state-file>` runs `kubectl rollout undo deployment/cashight-api -n cashight` only when `kubectl rollout history` shows more than one revision. It waits with `rollout status --timeout=5m` and resets each alias listed in the state file. It always exits 1.
  - `wait-revision.sh <api-url> <expected-hash> [timeout-seconds=180]` polls `<api-url>/health` until `.revision == expected`, then exits 0. On timeout it exits 1 and prints the last revision seen.

- [ ] **Step 1: Write the failing tests** in `v2-minimal-release.test.ts`.
  - Workflow:
    - Triggered on `push` to `cashight-v2` with paths including `backend/**`, `app/**`, `deploy/cashight/overlays/v2-minimal/**` and its own file, plus `workflow_dispatch`.
    - `concurrency.group == 'v2-minimal-release'` with `cancel-in-progress: false`.
    - Every job has `if` containing `vars.V2_TARGET == 'minimal'`, and no job has `environment`.
    - The SPA job `needs` the deploy job and sets `NEXT_PUBLIC_ENABLE_AI_SUMMARY: 'false'`.
    - The deploy job has a step running `rollback.sh` with `if: failure()`, after the step running `wait-revision.sh`.
    - The deploy job never runs `git push`.
  - In `v2-release-workflow.test.ts`: both jobs' `if` contains `vars.V2_TARGET != 'minimal'`.
  - `wait-revision.sh`, with a stub `curl` returning the old then the new revision: exit 0. When it always returns the old revision and `POLL_SECONDS=0` with a 1-second timeout: exit 1 with `last revision seen: <old>`.
  - `rollback.sh`:
    - With a stub history of 2 revisions and a state file naming both functions: the calls include `rollout undo` and two `update-alias … --function-version <recorded>`, and the exit code is 1.
    - With a history of 1 revision: no `rollout undo`, the log says `no previous revision`, and the exit code is 1.
    - With an empty state file: no `update-alias`, and the exit code is 1.
  - `deploy-workers.sh`: the state file is written before the first `update-function-code` call. That is the call order recorded by the stubs.
  - `platform-scripts.test.ts`: the bring-up tests still pass, with the token now coming from `mint-smoke-token.sh`.
- [ ] **Step 2: Run them to verify they fail.** Run: `pnpm test scripts/__tests__/v2-minimal-release.test.ts scripts/__tests__/v2-release-workflow.test.ts scripts/__tests__/platform-scripts.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement the scripts and the workflow.** The workflow has three jobs:
  - `image`: copy `v2-release.yaml`'s image job up to "Resolve digest" (`ubuntu-24.04-arm`, reuse an existing tag). No pin commit: the deployed digest goes to `$GITHUB_STEP_SUMMARY`, which is enough for traceability.
  - `deploy` (`needs: image`, `ubuntu-24.04-arm`, `id-token: write`):
    1. Install, then `pnpm build:lambdas`.
    2. `deploy-workers.sh dist/lambdas "$RUNNER_TEMP/aliases"`.
    3. `aws eks update-kubeconfig --name cashight-v2-min`.
    4. `pin-image.sh deploy/cashight/overlays/v2-minimal "$REPOSITORY" "$DIGEST" "$SHA"`, then `SHA=… yq -i '.spec.template.metadata.annotations."cashight.nghuy.link/app-version" = strenv(SHA)' deployment.yaml`.
    5. `kubectl apply -k deploy/cashight/overlays/v2-minimal`.
    6. `kubectl rollout status deployment/cashight-api -n cashight --timeout=5m`.
    7. Take the new hash from the newest ReplicaSet: `kubectl get rs -n cashight -l app.kubernetes.io/name=cashight-api` sorted by the `deployment.kubernetes.io/revision` annotation, reading `.metadata.labels."pod-template-hash"`. Then run `wait-revision.sh https://api.cashight-v2.nghuy.link "$HASH"`.
    8. `mint-smoke-token.sh`, then `smoke-serverless.mjs` with `APP_URL=https://cashight-v2.nghuy.link`, `API_URL=https://api.cashight-v2.nghuy.link`, `SMOKE_REQUIRE_NATIVE_AUTH=true` and `SMOKE_EXPECT_AI_SUMMARY_DISABLED=true`. Mask the token with `::add-mask::`.
    9. `if: failure()`: `rollback.sh "$RUNNER_TEMP/aliases"`.
  - `spa` (`needs: deploy`): copy `v2-release.yaml`'s spa job and add `NEXT_PUBLIC_ENABLE_AI_SUMMARY: 'false'`.
- [ ] **Step 4: Run the tests and actionlint.** Run: `pnpm test scripts/__tests__ && actionlint .github/workflows/v2-minimal-release.yaml .github/workflows/v2-release.yaml` (use `ci.yaml`'s lint step if actionlint is wired there). Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(ci): release v2-minimal with a rollout, revision and smoke gate"`

### Task 10: Operator scripts, the mutual-exclusion guard in bring-up, and docs

**Files:**
- Create: `scripts/v2-minimal/apply.sh`, `scripts/v2-minimal/teardown.sh`, `scripts/v2-minimal/check-overlay.sh`
- Modify: `scripts/platform/bring-up.sh` (guard at the top)
- Create: `docs/v2-minimal.md`
- Modify: `docs/platform.md`, `docs/v2-resources.md`, `CLAUDE.md` (command table rows: "v2 minimal: apply / deploy / teardown → docs/v2-minimal.md"), `docs/container-runtime.md` (if Task 1 has not already linked it)
- Test: `scripts/__tests__/platform-scripts.test.ts`, `scripts/__tests__/v2-minimal-scripts.test.ts`

**Interfaces:**
- Produces:
  - `bring-up.sh` dies with `bring-up: cashight-v2-min exists; run scripts/v2-minimal/teardown.sh first` when `aws eks describe-cluster --name cashight-v2-min` succeeds.
  - `apply.sh`:
    1. Refuses if `cashight-v2` exists.
    2. Runs a targeted apply of `module.cluster`, then a full apply. Plan to a file, then apply that plan, as `bring-up.sh`'s `apply_root` does.
    3. Runs `check-overlay.sh`.
    4. Runs `gh variable set V2_TARGET --body minimal`.
    5. Prints next steps: dispatch `v2-minimal-release.yaml`, then re-run `apply.sh` so the DNS record appears, then `terraform -chdir=terraform/grafana apply -var api_live=true -var collector_live=false`.
  - `teardown.sh "destroy cashight-v2-min"`, in this order:
    1. Refuses without the exact phrase.
    2. Sets Grafana `api_live=false`.
    3. `kubectl delete ingress cashight -n cashight --wait`.
    4. Waits until no ALB is tagged `elbv2.k8s.aws/cluster=cashight-v2-min`.
    5. `terraform destroy`.
    6. `gh variable set V2_TARGET --body full`.
  - `check-overlay.sh` compares the overlay's bucket and table names, the certificate ARN and the role ARN with `terraform output -json` of `terraform/v2` and `terraform/v2-minimal`, and exits 1 naming the key.

- [ ] **Step 1: Write the failing tests** with stub CLIs:
  - `bring-up.sh` exits 1 with the message above when the stub `aws eks describe-cluster --name cashight-v2-min` succeeds, and makes no `terraform` call.
  - `apply.sh` exits 1 when `cashight-v2` exists, before any `terraform` call.
  - `teardown.sh` without the phrase exits 1 with no calls. With the phrase, the recorded call order is grafana `api_live=false` → `kubectl delete ingress` → `describe-load-balancers` polling → `terraform … destroy` → `gh variable set V2_TARGET --body full`.
  - `check-overlay.sh` exits 1 naming `UPLOAD_BUCKET` when the stub `terraform output` disagrees.
- [ ] **Step 2: Run them to verify they fail.** Run: `pnpm test scripts/__tests__/platform-scripts.test.ts scripts/__tests__/v2-minimal-scripts.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement the scripts.** Reuse the `log`/`die`/`wait_for`/`apply_root` shapes from `bring-up.sh`.
- [ ] **Step 4: Write `docs/v2-minimal.md`.** Sections:
  - Overview and architecture (spec §4 diagram).
  - One-time setup.
  - Apply.
  - Deploy and how the gate works.
  - Rollback (automatic and manual: `kubectl rollout undo`, `aws lambda update-alias`).
  - Mutual exclusion with the full platform, including `V2_TARGET`.
  - Teardown.
  - Logs (`/cashight/v2-min/app`; kube-system logs are deliberately not shipped).
  - Security note: the public endpoint is `0.0.0.0/0`, so the full platform's CIDR check does not apply, plus the reason (spec §6.2).
  - Cost table with "estimate", "list price (date)" and "actual run rate" columns.
  - Enabling the tag budget after go-live.
  - Add one link line each to `docs/platform.md`, `docs/v2-resources.md` and `CLAUDE.md`.
- [ ] **Step 5: Run the tests and all checks.** Run: `pnpm test && pnpm tsc --noEmit && pnpm lint && bash scripts/platform/check-deploy-paths.sh && bash scripts/platform/check-collector.sh && bash scripts/platform/check-cashight-manifests.sh && bash scripts/platform/check-minimal-manifests.sh`, plus `terraform fmt -check -recursive terraform && for r in v2 v2-minimal platform platform-base; do terraform -chdir=terraform/$r test; done`. Expected: all PASS.
- [ ] **Step 6: Commit.** `git commit -m "docs(v2-minimal): add apply, deploy, rollback and teardown, and guard the full bring-up"`

### Task 11: Go-live and acceptance (live, from the workstation)

This task changes no code unless a step fails. Record every result in `docs/v2-minimal.md`, in an "Acceptance record (date)" section.

- [ ] **Step 1: Prices.** Run `aws pricing get-products --region us-east-1` for EKS (`AmazonEKS`, standard support), Fargate arm64 vCPU-hour and GB-hour, NAT gateway hour and GB, ALB hour and LCU, and public IPv4 hour, all filtered to `location = Asia Pacific (Singapore)`. Recompute the spec §8 table. Expected: a total of ≈ $165–175. If it is over $185, stop and report before applying.
- [ ] **Step 2: Apply.** With the full cluster down (`aws eks describe-cluster --name cashight-v2` → `ResourceNotFoundException`), run `bash scripts/v2-minimal/apply.sh`. Then:
  - `kubectl get pods -A -o wide`. Expected: `coredns` ×1 and `aws-load-balancer-controller` ×1 Running on `fargate-*` nodes.
  - Check DNS from a debug pod in `cashight` (`kubectl run -n cashight dns --rm -it --image=busybox:1.36 --restart=Never -- nslookup sts.ap-southeast-1.amazonaws.com`). Expected: it resolves. If pods cannot get IPs or DNS, add the `vpc-cni`/`kube-proxy` add-ons in Task 4 and record why.
  - `aws eks describe-cluster --name cashight-v2-min --query cluster.upgradePolicy`. Expected: `STANDARD`.
- [ ] **Step 3: First deploy.** Run `gh workflow run v2-minimal-release.yaml --ref cashight-v2` and watch it. Expected: green. Then run `apply.sh` again and expect `api.cashight-v2.nghuy.link` to resolve to the ALB. Then `kubectl get pods -A`. Expected: exactly three pods (spec acceptance 2). Check the memory use of `cashight-api` in CloudWatch Container Insights if it is on, or with `kubectl top` if metrics are available. Otherwise use `/proc/meminfo` inside the pod. If peak RSS stays under 200 MiB, lower the request and limit to `256Mi` (0.5 GB on Fargate) and update the Task 8 check.
- [ ] **Step 4: Broken-build rollback.** On a throwaway branch merged to `cashight-v2`, make `/readyz` return 503 (e.g. temporarily `isReady: () => false` in `start-api.ts`). Expected: the job fails at `rollout status`, `rollback.sh` runs, `/health` serves the previous hash, and the Lambda aliases are unchanged from before. Revert the commit, push, and expect green.
- [ ] **Step 5: Parsing through the Lambdas.** In the v2 SPA, upload `test-pdfs/VC_sao_ke_the_tin_dung_05_2026_9674.pdf` and `test-pdfs/vib_saoke_07_2026_4550.pdf`. Expected: the statement values match `CLAUDE.md`'s "Sample PDFs" section exactly (TPBank `statementBalance 37978402`, `totalSpend 26986712`, `totalCashback 519020`, 41 transactions; VIB `statementBalance 5591567`, `totalInstallments 5581667`, 3 transactions). The jobs show up in `/aws/lambda/cashight-v2-parser-worker` logs, and both DLQs are empty. The SPA shows no AI summary on the dashboard or the AWS invoice page.
- [ ] **Step 6: Mutual exclusion.** `bash scripts/platform/bring-up.sh`. Expected: it refuses with the Task 10 message.
- [ ] **Step 7: Logs and Grafana.** `aws logs describe-log-streams --log-group-name /cashight/v2-min/app`. Expected: only `fargate-*` streams from `cashight` pods. Apply Grafana with `api_live=true collector_live=false`. Expected: the uptime check is green.
- [ ] **Step 8: Seven days later.** Run Cost Explorer grouped by tag `Environment` and by service. Record the run rate next to the estimate. Then set `enable_v2_minimal_budget = true` in `terraform/platform-base/terraform.tfvars` and apply it.
- [ ] **Step 9: Commit the record.** `git commit -m "docs(v2-minimal): record go-live acceptance and the measured run rate"`
