# AWS Cost Review — July 2026

**Account:** `010382427026` · **Region:** `ap-southeast-1` (+ global)
**Period analysed:** 2026-07-01 → 2026-07-31 · **Reviewed:** 2026-08-03
**Source:** Cost Explorer `get-cost-and-usage` (UnblendedCost), cross-checked against live resource inventory.

> Scope note: this report is account-wide and spans several repos (`cashight`,
> `devops-engineer-profile`, `aws-eks-infra`, `aws-itp-poc`, `aws-etl-pipeline`).
> It lives in the `cashight` repo only because that was the working directory —
> relocate it if you keep a dedicated infra-docs home.

---

## 1. Executive summary

July cost **$95.03**. That figure is misleading as a baseline: roughly **$39 of it was
one-off experimentation** (Textract, Bedrock, EKS, NAT Gateway, Kinesis) that you have
already torn down — all of them bill **$0.00** in August MTD.

| | Monthly |
|---|---:|
| July 2026 actual | **$95.03** |
| Recurring baseline (what July would repeat) | **~$46** |
| Recurring baseline after the cleanup in §4 | **~$13** |
| Identified savings | **~$33/mo (~$394/yr)** |

The single largest ongoing waste is a **CloudWatch Logs VPC interface endpoint at
~$19.70/mo** that exists to solve a problem Lambda does not have (§4.1).

There is also a **Terraform drift landmine**: `cashight/terraform/waf.tf` declares a
CloudFront Web ACL that no longer exists in AWS. The next `terraform apply` will
silently re-create it and add **+$9/mo** (§5).

Sections **§8–§10 scope the same analysis to cashight specifically**. **§9 was the most
important finding in this document and is not a cost issue:** the Terraform config could
not be applied — from a workstation or from CI — without destroying the production DNS
record and breaking authentication, because the required variables were supplied by
neither. That is now fixed. **§10 records what was actually applied and verified.**

---

## 2. July 2026 — cost by service

Sorted descending. "Recurring?" = does it still bill in August MTD (Aug 1–3).

| Service | July | Recurring? | What it actually was |
|---|---:|:---:|---|
| AWS WAF | $24.45 | **Yes** | Fixed ACL/rule charges, not traffic. Requests were only $0.31 |
| Amazon Textract | $21.78 | No | 312 async form pages + 412 table pages — one-off |
| Amazon VPC | $13.05 | **Yes** | One CloudWatch Logs interface endpoint, 2 AZs |
| Bedrock — Claude Sonnet 4.6 | $9.61 | No | Model invocation usage |
| Tax | $8.64 | pro-rata | ~9% VAT |
| Amazon EKS | $4.81 | No | ~17 cluster-hrs + Fargate + ArgoCD/KRO/ACK add-ons |
| AWS KMS | $4.22 | **Yes** | 13 customer keys @ $1/mo (5 enabled, 8 pending deletion) |
| Amazon Route 53 | $2.51 | **Yes** | 1 zone + 2 health checks + queries |
| AWS Secrets Manager | $1.47 | **Yes** | 4 secrets @ $0.40 |
| EC2 — Other | $1.46 | No | NAT Gateway ~26 hrs ($1.18) + EBS snapshot + transfer |
| Amazon Kinesis | $1.30 | No | On-demand stream hours |
| AWS Config | $0.59 | No | ConfigurationItemRecorded; recorder since removed |
| AWS Glue | $0.52 | No | Crawler/catalog |
| Amazon ECR | $0.22 | **Yes** | `aws-cloudops-agent` image storage |
| Elastic Load Balancing | $0.20 | No | ALB from the EKS cluster |
| Amazon S3 | $0.09 | **Yes** | 23 buckets, mostly empty/small |
| Amazon RDS | $0.06 | No | — |
| AWS Cost Explorer | $0.03 | **Yes** | $0.01 per API call (incl. this analysis) |
| Everything else (< $0.01) | ~$0.01 | — | API Gateway, Amplify, DynamoDB, EFS, CloudTrail, Athena |
| **Total** | **$95.03** | | |

### Verified as already gone

Confirmed by live inventory, not just by cost: **0** EC2 instances, **0** EKS clusters,
**0** RDS instances/clusters, **0** Kinesis streams, **0** NAT Gateways, **0** load
balancers, **0** EBS volumes, **0** Elastic IPs, **0** Config recorders. Nothing to do here.

Note: **Amplify dropped from $12.28 (June) → $0.001 (July)** following the
2026-07-03 runtime decommission. That saving is already banked.

---

## 3. Recurring baseline (~$46/mo)

| Item | $/mo | Notes |
|---|---:|---|
| VPC interface endpoint (`logs`, 2 AZ) | 19.70 | 2 × ~$0.0135/AZ-hr × 730 |
| WAF `cashight-api` (REGIONAL) | 9.00 | $5 ACL + 4 rules — matches July's APS1 line exactly |
| WAF `CreatedByCloudFront-3ee0b04b` | 8.00 | $5 ACL + 3 rules |
| KMS — 5 enabled customer keys | 5.00 | $1/key |
| Route 53 | 2.45 | $0.50 zone + 2 × $0.75 health check + ~$0.45 queries |
| Secrets Manager — 4 secrets | 1.60 | $0.40/secret |
| ECR + S3 + Cost Explorer | 0.34 | |
| **Subtotal** | **~$46.09** | |
| *(transient)* KMS keys pending deletion | +8.00 | 8 keys; **auto-stops Aug 21–25**, no action needed |

Add ~9% tax on top.

---

## 4. Findings and Terraform remediation

Ranked by monthly saving. Each entry names the Terraform resource that owns it.

### 4.1 — CloudWatch Logs VPC endpoint is unnecessary · **$19.70/mo** · confidence: high

**Resource:** `vpce-0ab6475cfbc6e6f4d`, tagged `Project=devops-engineer-profile`,
`ManagedBy=Terraform`, `Name=blog-logs-endpoint`. Created 2026-07-12. Spans
`subnet-0599776dd7bd6e5e1` + `subnet-0457777c4eca4bc4f` (2 AZs = 2 billed ENIs).

**Terraform:** `devops-engineer-profile/inf/terraform/aws-s3-web/network.tf:79`
— `aws_vpc_endpoint.logs`, with `subnet_ids = aws_subnet.private[*].id`.

**Why it's waste.** The endpoint exists to give the VPC-attached `blog-api` Lambda a
path to CloudWatch Logs. The in-code comment in the sibling ETL stack states this
outright — *"CloudWatch Logs — required for VPC-attached Lambda log delivery"* — but
that premise is wrong:

1. **Lambda function log delivery does not traverse your VPC.** The Lambda service
   ships execution logs to CloudWatch out-of-band from the execution environment; it
   does not egress through the function's VPC ENI. A VPC-attached Lambda with no
   internet route and no logs endpoint still logs normally.
2. **`blog-api` makes no CloudWatch Logs API calls.** Grepping the source for
   `CloudWatchLogs`, `PutLogEvents`, and `@aws-sdk/client-cloudwatch-logs` returns
   nothing. Its only SDK client is `@aws-sdk/client-dynamodb`.
3. Its two real dependencies — DynamoDB (`blog-posts`) and S3
   (`blogs-nghuy-link-media-010382427026`) — are already served by **Gateway**
   endpoints in the same VPC, which are **free**.

**Remediation (option A — minimal, recommended).** Delete the interface endpoint only.

```hcl
# devops-engineer-profile/inf/terraform/aws-s3-web/network.tf
# DELETE the aws_vpc_endpoint.logs block (line 79)
# and any aws_security_group.endpoints rules that exist solely for it.
```

Then `terraform plan` should show exactly one destroy. Verify afterwards by invoking
`blog-api` once and confirming a new log stream appears in its log group.

**Remediation (option B — go further).** `blog-vpc` contains nothing but the
`blog-api` ENIs and the endpoints — no RDS, no EC2, no ElastiCache, nothing private to
reach. The Lambda has no reason to be VPC-attached at all. Removing
`vpc_config` at `aws-s3-web/lambda.tf:61` lets you delete the whole VPC, both gateway
endpoints, and the two security groups, and it removes VPC cold-start ENI setup.
Same $19.70 saving, plus a latency win, but it's a larger change to a live API — worth
doing as its own PR.

**Watch out:** the endpoint is currently multi-AZ. If you want to keep it for any
reason, dropping to a single subnet halves the cost to ~$9.85/mo. The ETL stack already
has a `var.interface_endpoint_multi_az` toggle for exactly this — `aws-s3-web` does not.

---

### 4.2 — CloudFront WAF on the static resume site · **$8.00/mo** · your call

**Resource:** `CreatedByCloudFront-3ee0b04b`
(`arn:aws:wafv2:us-east-1:010382427026:global/webacl/CreatedByCloudFront-3ee0b04b/6422aae5-59cc-4799-a873-9914fb2b1b4f`).
Rules: `AmazonIpReputationList`, `CommonRuleSet`, `KnownBadInputs` → $5 + $3.

**Attached to:** distribution `E3MGWTP58YX35G` — *"CloudFront Distribution for AWS Resume Web"*, alias `s3.nghuy.link`.

**Terraform ownership — read carefully.** The ACL itself was **created by the CloudFront
console wizard** (that's what the `CreatedByCloudFront-*` name means), so it is *not* in
any state file. Only the *association* is Terraform-managed:

```hcl
# devops-engineer-profile/inf/terraform/aws-cloudfront-s3-oac-resume/main.tf:88
web_acl_id = var.enable_waf ? var.waf_web_acl_id : null
```

**Assessment.** This is a read-only S3 static site serving a resume. There is no origin
to compromise, no database, no auth, no write path. Managed rule groups protect against
injection and bad inputs against *application* origins — against an S3 static site they
buy essentially nothing for $96/year.

**Remediation.**
1. Set `enable_waf = false` in the resume stack's tfvars → `terraform apply` detaches it.
   *(CloudFront takes ~15 min to propagate the disassociation.)*
2. The orphaned ACL still bills after detaching — delete it separately, since Terraform
   never owned it:
   ```bash
   aws wafv2 delete-web-acl --scope CLOUDFRONT --region us-east-1 \
     --name CreatedByCloudFront-3ee0b04b \
     --id 6422aae5-59cc-4799-a873-9914fb2b1b4f \
     --lock-token "$(aws wafv2 get-web-acl --scope CLOUDFRONT --region us-east-1 \
        --name CreatedByCloudFront-3ee0b04b \
        --id 6422aae5-59cc-4799-a873-9914fb2b1b4f --query LockToken --output text)"
   ```
   Step 2 must follow step 1 — WAF refuses to delete an ACL with a live association.

---

### 4.3 — Orphaned KMS keys · **$4.00/mo**

5 customer-managed keys are `Enabled` at $1/mo each. Four look orphaned:

| Alias | Key ID | Owning project | Status of that project |
|---|---|---|---|
| `alias/cashight-tfstate` | `85480863…` | cashight | **Active — keep** |
| `alias/music-etl-dev-terraform-state` | `042f21d2…` | music-etl | Redshift, Kinesis, Glue jobs all gone |
| `alias/aws-eks-infra-terraform-state` | `37ce60c4…` | aws-eks-infra | Cluster deleted; $0 EKS in August |
| `alias/itp-phi` | `28d2351f…` | aws-itp-poc | Source of July's $21.78 Textract bill |
| `alias/itp-poc-dev-linkage-vault` | `6b8138bc…` | aws-itp-poc | ″ |

**Order of operations matters.** Each key encrypts its project's Terraform *state
bucket*. Destroying a state bucket's KMS key before you have finished with the state
makes the state unreadable — you would lose the ability to `terraform destroy` the rest
of that project's resources. So for each retired project:

1. `terraform destroy` the stack (while the key still works),
2. then remove the `aws_kms_key` / `aws_kms_alias` resources,
3. then empty and delete the state bucket.

**Already handled — no action:** 8 further keys are in `PendingDeletion`, all from the
`aws-eks-infra-platform` teardown (cluster encryption, EFS, observability logs). They
stop billing automatically on their scheduled dates, **2026-08-21 through 2026-08-25**.
They account for $8/mo of the current run rate, which will fall off on its own.

---

### 4.4 — Duplicate Route 53 health check · **$0.75/mo**

Two HTTPS health checks target the identical endpoint — same FQDN `nghuy.link`, same
path `/`:

- `6844d4f4-8288-4059-bb5b-417a2cc8353b`
- `ac2de622-fa61-4404-852e-23a34290a211`

Almost certainly a re-apply artifact (one created, one orphaned from state). Confirm
which one is referenced by an `aws_route53_health_check` resource / a failover record
set, then delete the other. Only one hosted zone exists (`nghuy.link`, 20 records) — no
zone cleanup needed.

---

### 4.5 — Dead secret · **$0.40/mo**

`/music-etl/dev/redshift-admin` (last accessed 2026-07-12). The music-etl stack has no
Redshift cluster, no Kinesis stream, and no Glue jobs left. Delete with
`--force-delete-without-recovery`, or let the default 30-day recovery window run.

The other three (`/cashight/prod/{google-oauth,pdf-password,gemini-api-key}`) are live —
`pdf-password` was accessed 2026-08-02. **Keep.**

---

### 4.6 — Optional: trim the `cashight-api` WAF · **$0–9.00/mo**

`cashight-api` (REGIONAL, `61dc3e16-a5e9-4e9a-94f1-17f20bc3ea9b`) costs $9/mo:
`$5` ACL + 4 rules — `CommonRuleSet`, `KnownBadInputs`, `AmazonIpReputationList`,
`RateLimitPerIp`. Defined at `cashight/terraform/waf.tf:110`, associated at
`cashight/terraform/api.tf:99`.

This one guards a real authenticated API, so it is a genuine judgement call rather than
obvious waste. Three positions:

- **Keep as-is** — $9/mo for defence-in-depth on an internet-facing API.
- **Trim to `CommonRuleSet` + `RateLimitPerIp`** — saves $2/mo, keeps injection
  protection and rate limiting; drops the two lowest-value groups for a single-user app.
- **Delete entirely** — saves $9/mo. Relevant context: this ACL's
  `NoUserAgent_HEADER` rule (inside `CommonRuleSet`) is what returns **403 to
  User-Agent-less requests**, which has previously broken smoke tests and monitors from
  plain Node `fetch`. Browsers are unaffected. If you keep the ACL, consider a scoped
  rule-action override for that specific rule rather than removing the group.

Note the app is already gated behind Auth.js with a single allowlisted email, so WAF is
your second layer here, not your only one.

---

## 5. Terraform drift — will silently re-add $9/mo

`cashight/terraform/waf.tf:1` declares:

```hcl
resource "aws_wafv2_web_acl" "cashight" {
  provider = aws.global
  name     = "${var.project_name}-cloudfront"   # → "cashight-cloudfront"
  scope    = "CLOUDFRONT"
  # 4 rules: CommonRuleSet, KnownBadInputs, AmazonIpReputationList, RateLimitPerIp
}
```

and `cashight/terraform/edge.tf:149` attaches it unconditionally:

```hcl
web_acl_id = aws_wafv2_web_acl.cashight.arn
```

**But it does not exist in AWS.** `wafv2 list-web-acls --scope CLOUDFRONT` returns only
`CreatedByCloudFront-3ee0b04b`; distribution `EL1N2FM69ECNG` (*Cashight SPA —
production*) has an **empty** `WebACLId`. Someone deleted it out-of-band — consistent
with July's Global WAF line ($8.97 ACL + $6.18 rules ≈ 1.8 ACL-months) showing two
global ACLs billing for only part of the month.

**Consequence:** the next `terraform apply` in `cashight/terraform` re-creates the ACL
and re-attaches it — **+$9/mo**, unannounced, and it will look like an unrelated change
in the plan.

**Decide before your next apply**, and encode the decision:

- *Don't want it* → delete the `aws_wafv2_web_acl.cashight` block and set
  `web_acl_id = null` in `edge.tf`. Note the comment at `edge.tf:147` justifies the ACL
  as *"Retains Amplify protection until cutover"* — Amplify was decommissioned
  2026-07-03, so that rationale has expired.
- *Do want it* → apply deliberately and budget the $9/mo. Consider gating it behind a
  `var.enable_cloudfront_waf` flag so the cost is an explicit choice.

Either way, do not leave the drift in place.

---

## 6. Prioritised action list

| # | Action | Saving/mo | Risk | Owner |
|---|---|---:|---|---|
| 1 | Delete `aws_vpc_endpoint.logs` (`aws-s3-web/network.tf:79`) | **$19.70** | Low | devops-engineer-profile |
| 2 | Resolve WAF drift in `cashight/terraform` (§5) | **$9.00 avoided** | Low | cashight |
| 3 | `enable_waf = false` on resume stack + delete orphan ACL | **$8.00** | Low | devops-engineer-profile |
| 4 | Destroy retired projects, then their KMS keys (§4.3) | **$4.00** | Medium — order matters | itp-poc / eks-infra / music-etl |
| 5 | Delete duplicate Route 53 health check | $0.75 | Low | wherever DNS is managed |
| 6 | Delete `/music-etl/dev/redshift-admin` | $0.40 | Low | music-etl |
| 7 | *Optional:* trim or drop `cashight-api` WAF (§4.6) | $2.00–9.00 | Your call | cashight |
| | **Total (items 1–6)** | **~$32.85/mo** | | |

Post-cleanup run rate: **~$13/mo** (~$14 with tax), down from ~$46.
Annualised saving: **~$394**.

---

## 7. Non-cost observation: retired-project data

Not a cost issue — these total under $0.10/mo — but flagged for hygiene, since two of
them hold health-data-shaped content:

- `itp-poc-dev-raw-phi-010382427026`, `itp-poc-dev-data-lake-010382427026`,
  `itp-poc-dev-audit-logs-010382427026`
- DynamoDB: `itp-poc-dev-patients`, `-admission-episodes`, `-bleeding-events`,
  `-lab-measurements`, `-treatment-events`, `-linkage-vault`
- Glue database `itp_poc_dev_curated`

If the ITP POC is finished, deleting these is worth doing on data-minimisation grounds
regardless of the $0.09/mo. If the data is synthetic, it's purely optional.

Wider clutter, for context: **23 S3 buckets** and **12 DynamoDB tables** across ~8
projects, of which 7 buckets and 5 tables are Terraform state/lock pairs for stacks that
no longer have running resources.

---

## 8. cashight, scoped

Attribution here is manual — no cost-allocation tags are active, so Cost Explorer cannot
slice by project. Resources were matched to usage-type lines by hand; the WAF figures tie
out to the cent.

### 8.1 What cashight costs

| Item | July | Ongoing (pre-cleanup) |
|---|---:|---:|
| WAF `cashight-api` (REGIONAL, $5 ACL + 4 rules) | 9.00 | **9.00** |
| WAF `cashight-cloudfront` (GLOBAL, deleted mid-July) | ~7.15 | 0 — but see §5 |
| WAF request charges | 0.31 | 0.31 |
| Secrets Manager — 3 secrets @ $0.40 | 1.20 | 1.20 |
| KMS `cashight-tfstate` | 1.00 | 1.00 |
| S3 — 5 buckets, 107 MB total | ~0.05 | ~0.05 |
| API Gateway + DynamoDB + Lambda + CloudFront + Cognito + ACM + CloudWatch | <0.01 | <0.01 |
| **Total** | **~18.71** | **~11.56** |

cashight is roughly **20% of the account bill**, and **78% of cashight is a single WAF
Web ACL**.

### 8.2 Already optimal — deliberately not touched

Verified against live config, all of it already tight: 30-day retention on all 8 log
groups; DynamoDB `PAY_PER_REQUEST` holding 33 items; no provisioned or reserved
concurrency beyond parser-worker's deliberate `reserved_concurrent_executions = 2`;
lifecycle rules on `cashight-statements` (version expiry) and `cashight-uploads`;
3 CloudWatch alarms, inside the always-free allowance of 10; CodeDeploy-for-Lambda is
free; Cognito is free below 50k MAU; ACM certificates are free. There is no fat in the
compute or storage layer.

### 8.3 Changes made (branch `chore/aws-cost-cleanup`)

| Change | Saving/mo |
|---|---:|
| Deleted `terraform/waf.tf` — both Web ACLs — and the `aws_wafv2_web_acl_association.api` in `api.tf` | 9.00 |
| Cleared `web_acl_id` on the CloudFront distribution in `edge.tf`, resolving the §5 drift | 9.00 avoided |
| Removed the orphaned `aws_secretsmanager_secret.google_oauth` | 0.40 |
| Moved `pdf-password` + `gemini-api-key` from Secrets Manager to SSM SecureString parameters | 0.80 |
| **Total** | **~10.20/mo** |

Post-cleanup cashight run rate: **~$1.36/mo**, down from ~$11.56.

The application change backing the SSM move is in `backend/shared/secrets.ts`
(`GetParameterCommand` with `WithDecryption: true`, same cache and injected-client shape)
and `backend/shared/clients.ts`. Env vars were renamed `PDF_PASSWORD_SECRET_ID` →
`PDF_PASSWORD_PARAM` and `GEMINI_SECRET_ID` → `GEMINI_PARAM` deliberately: had the names
been kept, the currently-deployed code would have silently passed an SSM parameter name
to Secrets Manager. With the rename it fails loudly instead.
`@aws-sdk/client-secrets-manager` was dropped from `package.json`.

Verification: 440 tests pass across 48 files, `tsc --noEmit` clean, `eslint` reports 0
errors, `terraform validate` succeeds.

### 8.4 Rate limiting is gone with the WAF

`RateLimitPerIp` disappeared along with the ACL. The API is still behind Cognito and the
single-email allowlist, so this is not an authentication gap, but there is now nothing
throttling an authenticated caller. If that matters, an API Gateway usage plan with
throttle settings costs nothing and covers it.

---

## 9. Blocker (RESOLVED) — Terraform could not be applied safely

> **Status: resolved 2026-08-03.** Fixed in #112, and the cleanup in §8.3 was applied.
> See §10 for what actually happened. The analysis below is kept as the record of
> why the pipeline could not be trusted.

Applying from a working copy — or from CI as then written — would have damaged
production. This was a pre-existing condition, not something the cost cleanup
introduced.

`terraform/.gitignore` ignores `*.tfvars`, and the real `terraform.tfvars` is not on this
machine. `.github/workflows/infrastructure-deploy.yaml` runs a bare `terraform plan` with
no `-var-file` and no `TF_VAR_*` environment variables. So **neither path supplies the
variables**, and each falls back to defaults that do not match deployed reality:

| Variable | Default | Deployed reality | Effect of applying with the default |
|---|---|---|---|
| `cutover_dns_to_cloudfront` | `false` | `true` | Destroys `aws_route53_record.frontend_prod[0]` and drops the `cashight.nghuy.link` alias — **the production domain stops resolving** |
| `google_oauth_client_id` / `_secret` | `""` | real credentials | Rewrites `aws_cognito_identity_provider.google` with empty creds and nulls its provider URLs — **Google sign-in breaks** |
| `allowed_email` | `""` | `huynguyen260398@gmail.com` | Blanks `ALLOWED_EMAIL` on `cashight-auth-guard`; `requiredEnvironmentValue` throws at cold start, so the guard fails closed — **nobody can sign in** |

Confirmed by running `terraform plan` both ways: with defaults the plan is
`0 to add, 5 to change, 4 to destroy` including the Route 53 record; passing
`-var="cutover_dns_to_cloudfront=true"` removes the DNS destruction but leaves the
Cognito and auth-guard damage.

**Fix this before any apply**, by either restoring `terraform.tfvars` locally, or — better,
since it fixes CI too — adding the values as GitHub secrets and passing them in the
workflow:

```yaml
- name: Terraform plan
  env:
    TF_VAR_cutover_dns_to_cloudfront: "true"
    TF_VAR_allowed_email:             ${{ secrets.ALLOWED_EMAIL }}
    TF_VAR_google_oauth_client_id:     ${{ secrets.GOOGLE_OAUTH_CLIENT_ID }}
    TF_VAR_google_oauth_client_secret: ${{ secrets.GOOGLE_OAUTH_CLIENT_SECRET }}
  run: terraform plan -input=false -no-color -out=tfplan.bin
```

Apply the same block to the apply job. Until then the infrastructure workflow is a loaded
gun: any dispatch reverts the DNS cutover and breaks authentication.

Worth noting independently of cost: the deployed state currently cannot be reproduced
from the repository. That is the more serious finding in this review.

### 9.1 Deploy runbook, once variables are fixed

Order matters — Terraform and the Lambda code deploy through **separate** workflows
(`infrastructure-deploy.yaml` is manual dispatch; `application-deploy.yaml` fires on merge
to main), so the secrets migration cannot be a single step.

1. **Apply Terraform first.** This creates both SSM parameters with placeholder values,
   grants `ssm:GetParameter`, deletes the WAF ACLs, and removes the Secrets Manager
   secrets (7-day recovery window, so they are recoverable).
2. **Seed the real values immediately** — before any code deploy:
   ```bash
   aws ssm put-parameter --region ap-southeast-1 --overwrite --type SecureString \
     --name /cashight/prod/pdf-password  --value "$PDF_PASSWORDS_JSON"
   aws ssm put-parameter --region ap-southeast-1 --overwrite --type SecureString \
     --name /cashight/prod/gemini-api-key --value "$GEMINI_KEY"
   ```
   Retrieve the current values from Secrets Manager *before* step 1, or from the recovery
   window afterwards via `aws secretsmanager restore-secret`.
3. **Merge the PR** so `application-deploy.yaml` ships the SSM-reading code.
4. **Verify** both paths, since neither is covered by an automated smoke test: upload a
   password-protected statement (exercises `pdf-password`) and open a month's AI summary
   (exercises `gemini-api-key`).

Between steps 1 and 3 the deployed code still expects `PDF_PASSWORD_SECRET_ID` /
`GEMINI_SECRET_ID`, which no longer exist — PDF parsing and AI summaries will fail during
that window. Everything else, including sign-in and the dashboard, is unaffected. Keep the
window short, or apply step 1 from the feature branch just before merging.

---

## 10. Outcome — what was actually done

Executed 2026-08-03. All figures below are verified against live AWS state, not planned.

### 10.1 Applied

| Change | PR | Verification |
|---|---|---|
| Regional WAF `cashight-api` + its association destroyed | #111 | `list-web-acls --scope REGIONAL` returns empty |
| CloudFront WAF drift resolved (config no longer declares it) | #111 | plan is clean; nothing re-creates it |
| `pdf-password` + `gemini-api-key` moved to SSM SecureString | #111 | values re-read from SSM match the originals byte-for-byte |
| Orphaned `google-oauth` secret removed | #111 | scheduled for deletion |
| All three Secrets Manager secrets deleted | #111 | 7-day recovery window, expires 2026-08-10 |
| Terraform variable wiring + Cognito `provider_details` pinned | #112 | plan reduced to exactly the intended changes |

Final apply: **`2 to add, 4 to change, 5 to destroy`** — no unintended changes.

Verified after apply:

- `https://cashight.nghuy.link` → **HTTP 200**; `dns_cutover_active = true`. The DNS
  record the old defaults would have destroyed is intact.
- `https://api.cashight.nghuy.link/statements` → **401**, and **401 without a
  User-Agent header too**. Previously 403 — the `NoUserAgent_HEADER` rule that broke
  smoke tests and monitors is gone.
- IAM: both Lambda roles `allowed` for `ssm:GetParameter`; `implicitDeny` for
  `secretsmanager:GetSecretValue`.
- Deployed Lambda bundles contain `GetParameterCommand` and **zero**
  `GetSecretValueCommand` references.
- Application Deploy run: all six jobs green, including smoke tests.

### 10.2 Savings realised

| Item | $/mo |
|---|---:|
| Regional WAF `cashight-api` | 9.00 |
| CloudFront WAF re-creation avoided (drift) | 9.00 avoided |
| Secrets Manager → SSM (2 secrets) | 0.80 |
| Orphaned `google-oauth` secret | 0.40 |
| Resume-site CloudFront WAF (actioned separately, §4.2) | 8.00 |
| **Total** | **~18.20/mo realised, plus 9.00 avoided** |

cashight itself drops from ~$11.56/mo to **~$1.36/mo**. Account recurring baseline
falls from ~$46/mo to roughly **$28/mo**, and to ~$20/mo once the eight
pending-deletion KMS keys finish expiring on 2026-08-21..25.

### 10.3 Notes worth keeping

**The `google-oauth` secret was never populated.** `VersionIdsToStages` was `null` —
no value was ever written to it. It was an empty shell from creation, which is a
stronger finding than the "never accessed" one in §4.5.

**Cognito returns the Google client secret in plaintext** via
`DescribeIdentityProvider`. That is how the three GitHub secrets were sourced without
access to the original tfvars. It also means anyone with
`cognito-idp:DescribeIdentityProvider` in this account can read that credential —
worth remembering when granting Cognito read access.

**Plan against a moving target.** The first saved plan was captured while a CodeDeploy
canary from the #112 merge was mid-flight at 10% traffic, and included removing a
`routing_config` that vanished when the canary completed. It was discarded and re-planned
after the deploy settled. When Terraform and application deploys share resources, plan
after the deploy finishes, not during.

### 10.4 Still open

- **#113** — the Terraform CI role. `infrastructure-deploy.yaml` still cannot run:
  `vars.AWS_INFRA_ROLE_ARN` is unset and the role does not exist. Terraform is still
  applied from a workstation. **The `production` environment has no protection rules**,
  so required reviewers must be added before an admin CI role is safe to merge.
- **Account-wide items from §6** — the ~$19.70/mo `blog-api` logs VPC endpoint is the
  single largest remaining line and lives in `devops-engineer-profile`, untouched here.
- **Retired-project data** (§7) — `itp-poc` buckets and tables, pending a decision.

---

## Appendix — how to reproduce

```bash
# Cost by service for the month
aws ce get-cost-and-usage \
  --time-period Start=2026-07-01,End=2026-08-01 \
  --granularity MONTHLY --metrics UnblendedCost \
  --group-by Type=DIMENSION,Key=SERVICE --region us-east-1

# Drill into one service (swap SERVICE value)
aws ce get-cost-and-usage \
  --time-period Start=2026-07-01,End=2026-08-01 \
  --granularity MONTHLY --metrics UnblendedCost \
  --group-by Type=DIMENSION,Key=USAGE_TYPE \
  --filter '{"Dimensions":{"Key":"SERVICE","Values":["AWS WAF"]}}' --region us-east-1
```

Cost Explorer API calls bill **$0.01 each** — the queries behind this report cost ~$0.03.

**Caveats.** August MTD figures cover Aug 1–2 only (Aug 3 had not posted at time of
writing), so run-rate extrapolations from them carry a partial-day margin. Monthly WAF
and KMS charges are billed hourly and pro-rate, so a resource created mid-month
understates its full-month cost — the $/mo figures in §3 are full-month rates, not July
actuals.
