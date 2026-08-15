# AWS Cost Explorer operations

This runbook enables, verifies, monitors, and rolls back Cashight's read-only
AWS Cost Explorer dashboard. Keep the frontend build flag disabled until the
authenticated production smoke query and alarm review both pass.

## Cost and safety model

- AWS currently charges **$0.01 per Cost Explorer API request** against the
  primary billing view. Custom billing views are charged $0.01 per source per
  request. Pagination therefore increases query cost. Confirm the current rate
  on the official [AWS Cost Explorer pricing page](https://aws.amazon.com/aws-cost-management/aws-cost-explorer/pricing/)
  before enabling the feature.
- Cashight caches complete results for one hour when a report includes the
  current month and for 24 hours for closed historical periods.
- A manual refresh may bypass one canonical query's cache only once per
  workspace every five minutes. The Lambda has reserved concurrency of two and
  coordinates concurrent cache misses through DynamoDB.
- CSV download URLs expire after five minutes. Encrypted export objects are
  private, versioning is disabled, and the `exports/` lifecycle expires them
  after one day.
- Cost Explorer data is not real time. AWS says current-month data is normally
  ready in about 24 hours and is updated at least daily. See
  [Enabling Cost Explorer](https://docs.aws.amazon.com/cost-management/latest/userguide/ce-enable.html).

## Prerequisites

1. Sign in to the deployment AWS account with billing-administration access.
2. Open the AWS Billing and Cost Management console, choose **Cost Explorer**,
   and choose **Launch Cost Explorer** if it is not already enabled. Cost
   Explorer cannot be enabled through its API. Allow up to 24 hours for current
   data and longer for the complete historical window.
3. Keep the production GitHub Actions variable
   `NEXT_PUBLIC_ENABLE_AWS_COST_EXPLORER` unset or set to `false`.
4. Before every deployment, obtain a fresh access token from a native Cognito
   user and update the production secret `SMOKE_NATIVE_ACCESS_TOKEN`. The
   workflow enables `SMOKE_REQUIRE_NATIVE_AUTH`, so a missing or expired token
   fails deployment verification. Never paste the token into logs, issues,
   shell history, or the runbook.
5. Apply and verify the Terraform plan before deploying the application:

   ```bash
   cd terraform
   terraform init
   terraform plan
   terraform apply
   ```

The `cashight-cost-explorer-api-role` policy is intentionally read-only. Its
AWS billing permissions are exactly:

- `ce:GetCostAndUsage`
- `ce:GetCostAndUsageWithResources`
- `ce:GetCostForecast`
- `ce:GetUsageForecast`
- `ce:GetDimensionValues`
- `ce:GetTags`
- `ce:GetCostCategories`
- `ce:GetCostAndUsageComparisons`
- `ce:GetCostComparisonDrivers`
- `billing:ListBillingViews`
- `billing:GetBillingView`
- `aws-portal:ViewBilling`

Cost Explorer and billing-view actions are scoped as narrowly as AWS supports;
there is no `ce:*` or billing write grant. The role also has owner-scoped
DynamoDB cache/report access and `s3:GetObject`/`s3:PutObject` only under the
private export bucket's `exports/` prefix. Cross-check supported resource types
against the official [Cost Explorer service authorization reference](https://docs.aws.amazon.com/service-authorization/latest/reference/list_ce.html).

## Disabled deployment and smoke query

Deploy once with the frontend flag false. The production workflow deploys the
`cost-explorer-api` Lambda but statically renders the dashboard route as not
enabled, so the shipped browser route issues no paid queries. The deployed API
remains callable by authorized native sessions for smoke verification.

Run the smoke script with a short-lived native token:

```bash
read -rsp 'Cognito access token: ' CASHIGHT_SMOKE_TOKEN
printf '\n'
APP_URL=https://next.cashight.nghuy.link \
API_URL=https://api.cashight.nghuy.link \
SMOKE_REQUIRE_NATIVE_AUTH=true \
SMOKE_NATIVE_ACCESS_TOKEN="$CASHIGHT_SMOKE_TOKEN" \
pnpm smoke:serverless
unset CASHIGHT_SMOKE_TOKEN
```

The authenticated Cost Explorer check builds one closed-month, monthly,
service-grouped `UnblendedCost` report. Its first request uses the manual refresh
path and must report `source: AWS`; the identical second request must report
`source: CACHE` with the same overview total. The validator rejects echoed
tokens, credentials, request/filter data, billing-view ARNs, linked-account or
12-digit account values.

If the target account returns `COST_EXPLORER_DISABLED`, the script prints an
explicit environment skip and exits successfully. Enable Cost Explorer in the
console, wait for data preparation, and rerun the smoke query. Do not enable the
frontend flag on a skipped result. A cooldown rejection means the same smoke
query ran within five minutes; wait until the cooldown expires and retry.

## Alarm review

Before enabling the frontend, confirm these CloudWatch alarms are `OK` and that
the configured SNS email subscription is confirmed:

- `cashight-cost-explorer-api-errors`
- `cashight-cost-explorer-api-duration`
- `cashight-cost-explorer-api-throttles`
- `cashight-cost-explorer-access-denied`
- `cashight-cost-explorer-disabled`
- `cashight-cost-explorer-cache-corruption`
- `cashight-cost-explorer-export-failures`

Useful commands:

```bash
aws cloudwatch describe-alarms \
  --alarm-name-prefix cashight-cost-explorer \
  --query 'MetricAlarms[].{Name:AlarmName,State:StateValue,Reason:StateReason}'

aws logs tail /aws/lambda/cashight-cost-explorer-api \
  --since 1h --format short
```

Logs may contain request IDs, status codes, counts, latency, cache status, and
typed error codes. They must not contain tokens, report filters, tag values,
linked-account values, presigned URLs, raw AWS responses, or credentials.

## Enable the frontend

Only after the native smoke result passes and all alarms are healthy:

1. Set the production GitHub Actions variable
   `NEXT_PUBLIC_ENABLE_AWS_COST_EXPLORER=true`.
2. Rerun **Application Deploy** using the same verified CI run ID. This rebuilds
   the static frontend with the flag enabled and redeploys the pinned Lambda
   artifact.
3. Sign in through native Cognito and verify the page labels the first report as
   live AWS data and a repeated report as cached data.
4. Sign in through Google and verify that only the Cognito re-auth warning is
   displayed and no `/aws/cost-explorer/*` request is issued.

## Granular and resource-level data

Leave both Terraform variables false by default:

```hcl
enable_cost_explorer_granular_data             = false
cost_explorer_granular_data_enabled_out_of_band = false
```

To opt in, first review the current pricing page. AWS currently describes hourly
granularity charges as $0.00000033 per hosted usage record per day (equivalent
to $0.01 per 1,000 usage records monthly), with a 14-day lookback. Then enable
the required data preference manually in Cost Explorer as the management
account. Resource/hourly data can take up to 48 hours to become available; see
[EC2 resource-level data at hourly granularity](https://docs.aws.amazon.com/cost-management/latest/userguide/ce-ec2-hourly.html).

Only after the AWS preference is active, set both Terraform variables to true
and apply. Terraform deliberately rejects the application capability flag when
the out-of-band acknowledgement remains false. Revert both flags to false to
hide granular controls without deleting historical AWS data.

## Export-bucket inspection

Inspect configuration and metadata only; do not download production CSV files
unless investigating an authorized user report.

```bash
EXPORT_BUCKET=$(cd terraform && terraform output -raw cost_exports_bucket_name)

aws s3api get-public-access-block --bucket "$EXPORT_BUCKET"
aws s3api get-bucket-encryption --bucket "$EXPORT_BUCKET"
aws s3api get-bucket-lifecycle-configuration --bucket "$EXPORT_BUCKET"
aws s3api get-bucket-versioning --bucket "$EXPORT_BUCKET"
aws s3api list-objects-v2 --bucket "$EXPORT_BUCKET" --prefix exports/ \
  --query '{Count:KeyCount,Objects:Contents[].{Key:Key,Size:Size,Modified:LastModified}}'
```

Expected state: all public-access blocks true, AES256 default encryption,
versioning disabled, and a one-day expiration rule for `exports/`. Object keys
contain only workspace, canonical-query digest, and generated UUID segments.

## Rollback

1. Set `NEXT_PUBLIC_ENABLE_AWS_COST_EXPLORER=false` in the production GitHub
   Actions variables.
2. Rerun **Application Deploy** from the last known-good CI run. The static page
   becomes unavailable immediately after the CloudFront deployment; the backend
   may remain deployed without browser callers.
3. If a Lambda canary alarmed, confirm CodeDeploy restored the previous `live`
   alias version. Do not force an alias or bypass the canary workflow.
4. For a suspected permission or data leak, keep the frontend disabled, revoke
   the Cost Explorer Lambda's inline permissions through Terraform, inspect
   sanitized CloudWatch logs, and rotate any exposed token outside this repo.
5. Re-enable only after the native smoke query, Google denial flow, export-bucket
   inspection, and all alarms pass again.
