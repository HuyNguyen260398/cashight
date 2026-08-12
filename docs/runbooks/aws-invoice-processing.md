# AWS Invoice Processing Runbook

This runbook covers Cashight's isolated AWS consolidated-invoice pipeline. The
feature must remain disabled (`NEXT_PUBLIC_ENABLE_AWS_BILLING_INVOICE=false`)
until the verification checklist at the end passes in the target environment.

## Supported document contract

Parser `aws-inc-consolidated-usd` version 2 supports an unencrypted, USD,
consolidated invoice issued by `Amazon Web Services, Inc.`. Detection requires
these exact layout markers:

- `Amazon Web Services, Inc. Invoice` (the seller heading; the seller name also
  appears in per-page legal boilerplate, which is deliberately ignored)
- `Invoice Summary`
- `Detail for Consolidated Bill`
- `Activity By Account`

Any other AWS selling entity — a row matching `Amazon Web Services … Invoice`
that is not the heading above — fails closed.

### Layout model

The document is an indent-driven outline, not a column table. Labels sit in a
left band at fixed x indents and every amount sits in a right-hand column past
x=400:

| Indent | Meaning |
| --- | --- |
| x=36 | page banners, footers, legal boilerplate — ignored |
| x=40 | section heading, or a section total when it carries an amount |
| x=50 | item: a service name, or an account label `Name (123456789012)` |
| x=60 | component: `Charges`, `Credits`, or a tax line |

Indents are only 4pt apart, so the matching tolerance must stay under 4.
Sections persist across page boundaries — a service list continued on the next
page keeps appending to the section that opened it.

Tax is itemized under several labels that all fold into one tax figure:
`Tax`, `VAT`, `GST`, `CT`, `ST`, and `Estimated US sales tax to be collected`
(trailing footnote markers such as `VAT **` are stripped). An unrecognized
component label fails closed with `UNKNOWN_COMPONENT_LABEL` rather than being
silently dropped.

Sections: `Summary`, `Detail for Consolidated Bill`, `Activity By Account`, then
one `Summary for Linked Account` + `Detail for Linked Account` block per linked
account. Section totals are `Total for this invoice`, `Total allocated for this
invoice`, and `Account <id> total allocated for this invoice`.

### Reconciliation

Every total is reconciled in integer cents; the identity throughout is
`total = charges - credits + tax`:

- each service and each account item against its own components
- the summary block, the header `TOTAL AMOUNT DUE ON …` banner, and
  `Total for this invoice` must all state the same amount due
- consolidated service charge/tax sums against the summary charges/tax
- linked-account totals sum against `Total allocated for this invoice`
- each account's service charge/tax sums against that account's totals

Zero-valued services participate in reconciliation and are then filtered from
the reported lists. A linked account with no billable usage legitimately ends up
with an empty service list and a zero total.

Unknown seller/layout markers fail with `UNSUPPORTED_AWS_INVOICE`; any
reconciliation failure uses `INVOICE_TOTAL_MISMATCH`. Neither failure writes
invoice JSON or metadata.

Persisted and returned data may contain only masked `accountLast4` values. Bill
to/address data, invoice numbers, full account IDs, account labels, extracted
text, and raw rows are prohibited. Do not print PDF text or parser structures
during investigation.

## Local private-fixture verification

Keep the user's invoice outside Git; all PDFs and `test-pdfs/` are ignored.
Point the script at it only for the command invocation:

```bash
AWS_INVOICE_FIXTURE=/absolute/path/to/private-invoice.pdf pnpm test:aws-invoice-parser
```

Expected output is sanitized and contains only parser ID/version, billing
month, currency, service/account counts, and these final lines:

```text
Reconciliation: PASS
Prohibited-field scan: PASS
```

Never paste the input PDF, extracted lines, account IDs, invoice number,
customer name, or address into CI output, issues, chat, or CloudWatch.

## Upload and job lifecycle

1. The browser hashes the PDF and calls `POST /aws/invoices/uploads`.
2. The API writes a `PENDING_UPLOAD` job and returns a five-minute presigned PUT.
3. The browser PUTs the PDF under `uploads/aws-invoices/primary/{jobId}.pdf`.
4. The exact S3 prefix notification sends only invoice objects to
   `cashight-invoice-parse`; the invoice worker transitions the job to
   `PROCESSING`.
5. The worker parses, reconciles, validates the strict schema, writes
   `users/primary/aws-invoices/{year}/{year-month}.json`, writes metadata, and
   marks the job `SUCCEEDED`.
6. The browser polls with bounded backoff and refreshes detail, dashboard, and
   history only after success.

A duplicate month ends in `CONFLICT`. Cancel performs no write. “Replace
invoice” repeats upload creation with `force: true`; the stable monthly key is
overwritten and S3 versioning retains the previous object for 90 days.

## Monitoring and incident triage

Watch these alarms together:

- `cashight-aws-invoices-api-errors`
- `cashight-aws-invoice-summary-api-errors`
- `cashight-invoice-parser-worker-errors`
- `cashight-invoice-parser-worker-duration`
- `cashight-invoice-parser-worker-throttles`
- `cashight-invoice-total-mismatch`
- `cashight-invoice-parse-queue-age`
- `cashight-invoice-parse-dlq-messages`
- `cashight-invoice-parser-missing-invocations`

Safe investigation fields are request/job IDs, object key, job state, error
code, parser ID/version, counts, totals, SHA-256, timing, and `accountLast4`.
Never log or query raw file content, extracted text, full account IDs, identity
headers, presigned URLs, or secrets.

For a mismatch:

1. Confirm `ErrorCode=INVOICE_TOTAL_MISMATCH` in the privacy-safe metric and the
   job record.
2. Check parser version, object checksum, page count, and which reconciliation
   invariant failed; do not add row contents to logging.
3. Reproduce locally with the private-fixture command above.
4. If the layout changed, add a new fixture-free layout-row test and parser
   variant. Do not weaken or bypass reconciliation.

For queue backlog or DLQ messages, first fix the worker/configuration cause.
Use Terraform outputs to resolve exact queue URLs:

```bash
cd terraform
terraform output -raw invoice_parse_queue_url
terraform output -raw invoice_parse_dlq_url
```

Then start an SQS redrive from the DLQ to its configured source queue using the
AWS console, or with the exact ARNs obtained from `aws sqs get-queue-attributes`:

```bash
aws sqs start-message-move-task --source-arn <invoice-dlq-arn> --destination-arn <invoice-queue-arn>
```

Redrive only after confirming messages reference
`uploads/aws-invoices/`; never move invoice messages to the statement queue.

## Recovering an overwritten or deleted month

The statements bucket has versioning enabled and expires noncurrent versions
after 90 days. Resolve the bucket from `terraform output statements_bucket_name`
and the exact monthly key from the known month. List versions without printing
object contents:

```bash
aws s3api list-object-versions \
  --bucket <statements-bucket> \
  --prefix users/primary/aws-invoices/2026/2026-07.json
```

Restore a chosen version by copying that version onto the same key, then
restore/rebuild the matching DynamoDB metadata through an approved maintenance
procedure. Validate the restored object with `AwsInvoiceSchema` before making
it current. Do not download or display the JSON in shared logs.

## Feature enablement and rollback

Before enabling, run:

```bash
pnpm lint
pnpm tsc --noEmit
pnpm test
pnpm build
pnpm exec playwright test tests/e2e/aws-billing-invoice.spec.ts
pnpm security:scan-logs
cd terraform
terraform fmt -check -recursive
terraform validate
terraform test
```

Run the production smoke with a short-lived native Cognito token and a
synthetic, non-private PDF available only in the smoke environment:

```bash
APP_URL=https://<app-host> \
API_URL=https://<api-host> \
SMOKE_NATIVE_ACCESS_TOKEN=<short-lived-token> \
SMOKE_REQUIRE_NATIVE_AUTH=true \
AWS_INVOICE_FIXTURE=/secure/path/to/synthetic-aws-invoice.pdf \
pnpm smoke:serverless
```

The smoke uploads with `force: true`, verifies success and the dashboard
schema/privacy boundary, then deletes the synthetic month. Never use the user's
private fixture in CI or production smoke.

After all checks pass, rebuild the frontend with
`NEXT_PUBLIC_ENABLE_AWS_BILLING_INVOICE=true` and deploy through the normal
application workflow. Roll back by rebuilding with the flag set to `false` and
redeploying the last known-good Lambda aliases. Leave queues/buckets in place so
in-flight jobs and S3 versions remain recoverable.

## Adding a future parser variant

Implement a new `AwsInvoiceParser` beside the known-layout parser with a unique
ID and version, strict mutually exclusive markers, coordinate-row tests, and
all integer-cent reconciliation checks. Add it to the parser registry only
after tests prove unknown/conflicting layouts fail closed. Preserve the same
strict output schema and privacy scan; a new variant must not add identity,
invoice-number, full-account, label, address, object-key, or raw-text fields.
