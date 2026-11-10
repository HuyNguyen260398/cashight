# The parse workers as SQS-triggered Lambdas (spec §4.4), pointed at the v2
# stores. CI deploys the code (scripts/v2-minimal/deploy-workers.sh): it
# publishes a version and moves the `live` alias, so Terraform ignores the code
# and the alias version and never fights it.
#
# Queue visibility: Lambda requires the visibility timeout to be at least the
# function timeout. The v2 queues use 360 s (terraform/v2/data.tf) and the
# longest timeout here is 300 s, so no queue change is needed. AWS recommends
# 6x; meeting it would change the full platform's retry behaviour (spec §4.4).

data "archive_file" "worker_placeholder" {
  type        = "zip"
  output_path = "${path.module}/.placeholder.zip"

  source {
    content  = "placeholder"
    filename = "index.js"
  }
}

locals {
  pdf_password_param_name = "/cashight/prod/pdf-password"
  # Shared with v1 and read-only here (terraform/compute.tf).
  pdf_password_param_arn = "arn:aws:ssm:${var.aws_region}:${local.account_id}:parameter${local.pdf_password_param_name}"

  sqs_consume = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes", "sqs:ChangeMessageVisibility"]

  workers = {
    parser_worker = {
      name        = "cashight-v2-parser-worker"
      role_name   = "cashight-v2-min-parser-worker"
      memory_size = 1536
      timeout     = 120
      reserved    = 2 # the old KEDA maximum
      queue_arn   = local.v2.parse_queue_arn
      extra_env   = { PDF_PASSWORD_PARAM = local.pdf_password_param_name }
    }
    invoice_parser_worker = {
      name        = "cashight-v2-invoice-parser-worker"
      role_name   = "cashight-v2-min-invoice-parser-worker"
      memory_size = 2048
      timeout     = 300
      reserved    = 1 # the old KEDA maximum
      queue_arn   = local.v2.invoice_parse_queue_arn
      extra_env   = {}
    }
  }

  # Copied from terraform/platform/workloads.tf (local.workloads["parser-worker"]
  # and ["invoice-parser-worker"]), plus Logs on the function's own log group.
  # Keep in sync.
  worker_statements = {
    parser_worker = [
      { sid = "S3ReadDeleteUploads", actions = ["s3:GetObject", "s3:DeleteObject"], resources = ["${local.v2.uploads_bucket_arn}/uploads/*"] },
      { sid = "S3ReadWriteStatements", actions = ["s3:PutObject", "s3:GetObject"], resources = ["${local.v2.statements_bucket_arn}/users/*"] },
      { sid = "DynamoDBAccess", actions = ["dynamodb:PutItem", "dynamodb:GetItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem"], resources = [local.v2.table_arn] },
      { sid = "GetPdfPassword", actions = ["ssm:GetParameter"], resources = [local.pdf_password_param_arn] },
      { sid = "SQSConsume", actions = local.sqs_consume, resources = [local.v2.parse_queue_arn] },
      { sid = "Logs", actions = ["logs:CreateLogStream", "logs:PutLogEvents"], resources = ["${aws_cloudwatch_log_group.parser_worker.arn}:*"] },
    ]
    invoice_parser_worker = [
      { sid = "S3ReadDeleteInvoiceUploads", actions = ["s3:GetObject", "s3:DeleteObject"], resources = ["${local.v2.uploads_bucket_arn}/uploads/aws-invoices/*"] },
      { sid = "S3ReadWriteInvoices", actions = ["s3:GetObject", "s3:PutObject"], resources = ["${local.v2.statements_bucket_arn}/users/*/aws-invoices/*"] },
      # Month-conflict detection needs a 404, not a 403, for a missing key.
      { sid = "S3ListStatementsBucket", actions = ["s3:ListBucket"], resources = [local.v2.statements_bucket_arn] },
      { sid = "DynamoDBInvoiceAccess", actions = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem"], resources = [local.v2.table_arn] },
      { sid = "SQSConsumeInvoiceQueue", actions = local.sqs_consume, resources = [local.v2.invoice_parse_queue_arn] },
      { sid = "Logs", actions = ["logs:CreateLogStream", "logs:PutLogEvents"], resources = ["${aws_cloudwatch_log_group.invoice_parser_worker.arn}:*"] },
    ]
  }

  worker_environment = {
    TABLE_NAME        = local.v2.table_name
    UPLOAD_BUCKET     = local.v2.uploads_bucket_name
    STATEMENTS_BUCKET = local.v2.statements_bucket_name
    STORAGE_REGION    = var.aws_region
  }
}

data "aws_iam_policy_document" "lambda_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

# ── parser-worker ─────────────────────────────────────────────────────────────

resource "aws_cloudwatch_log_group" "parser_worker" {
  #checkov:skip=CKV_AWS_158:AWS-owned encryption; the logs hold no secrets or PANs (PCI convention).
  #checkov:skip=CKV_AWS_338:7-day retention is the cost decision in spec §1 (decision 3).
  name              = "/aws/lambda/${local.workers.parser_worker.name}"
  retention_in_days = 7
}

resource "aws_iam_role" "parser_worker" {
  name               = local.workers.parser_worker.role_name
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

data "aws_iam_policy_document" "parser_worker" {
  dynamic "statement" {
    for_each = local.worker_statements.parser_worker
    content {
      sid       = statement.value.sid
      effect    = "Allow"
      actions   = statement.value.actions
      resources = statement.value.resources
    }
  }
}

resource "aws_iam_role_policy" "parser_worker" {
  name   = local.workers.parser_worker.role_name
  role   = aws_iam_role.parser_worker.id
  policy = data.aws_iam_policy_document.parser_worker.json
}

resource "aws_lambda_function" "parser_worker" {
  #checkov:skip=CKV_AWS_50:X-Ray off; no tracing backend in v2 minimal.
  #checkov:skip=CKV_AWS_272:Code signing is not used for this repo's Lambdas.
  #checkov:skip=CKV_AWS_116:The DLQ is on the source queue (terraform/v2), as SQS event sources require.
  #checkov:skip=CKV_AWS_117:The worker needs only public AWS endpoints; a VPC would need a NAT path.
  #checkov:skip=CKV_AWS_173:Environment holds names only; secrets stay in SSM.
  function_name                  = local.workers.parser_worker.name
  role                           = aws_iam_role.parser_worker.arn
  handler                        = "index.handler"
  runtime                        = "nodejs22.x"
  architectures                  = ["arm64"]
  timeout                        = local.workers.parser_worker.timeout
  memory_size                    = local.workers.parser_worker.memory_size
  reserved_concurrent_executions = local.workers.parser_worker.reserved
  publish                        = true
  filename                       = data.archive_file.worker_placeholder.output_path
  source_code_hash               = data.archive_file.worker_placeholder.output_base64sha256

  ephemeral_storage {
    size = 1024
  }

  environment {
    variables = merge(local.worker_environment, local.workers.parser_worker.extra_env)
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }

  depends_on = [aws_cloudwatch_log_group.parser_worker, aws_iam_role_policy.parser_worker]
}

resource "aws_lambda_alias" "parser_worker_live" {
  name             = "live"
  function_name    = aws_lambda_function.parser_worker.function_name
  function_version = aws_lambda_function.parser_worker.version

  lifecycle {
    ignore_changes = [function_version]
  }
}

resource "aws_lambda_event_source_mapping" "parser_worker" {
  event_source_arn                   = local.workers.parser_worker.queue_arn
  function_name                      = aws_lambda_alias.parser_worker_live.arn
  batch_size                         = 1
  function_response_types            = ["ReportBatchItemFailures"]
  maximum_batching_window_in_seconds = 0
}

# ── invoice-parser-worker ─────────────────────────────────────────────────────

resource "aws_cloudwatch_log_group" "invoice_parser_worker" {
  #checkov:skip=CKV_AWS_158:AWS-owned encryption; the logs hold no secrets or PANs (PCI convention).
  #checkov:skip=CKV_AWS_338:7-day retention is the cost decision in spec §1 (decision 3).
  name              = "/aws/lambda/${local.workers.invoice_parser_worker.name}"
  retention_in_days = 7
}

resource "aws_iam_role" "invoice_parser_worker" {
  name               = local.workers.invoice_parser_worker.role_name
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

data "aws_iam_policy_document" "invoice_parser_worker" {
  dynamic "statement" {
    for_each = local.worker_statements.invoice_parser_worker
    content {
      sid       = statement.value.sid
      effect    = "Allow"
      actions   = statement.value.actions
      resources = statement.value.resources
    }
  }
}

resource "aws_iam_role_policy" "invoice_parser_worker" {
  name   = local.workers.invoice_parser_worker.role_name
  role   = aws_iam_role.invoice_parser_worker.id
  policy = data.aws_iam_policy_document.invoice_parser_worker.json
}

resource "aws_lambda_function" "invoice_parser_worker" {
  #checkov:skip=CKV_AWS_50:X-Ray off; no tracing backend in v2 minimal.
  #checkov:skip=CKV_AWS_272:Code signing is not used for this repo's Lambdas.
  #checkov:skip=CKV_AWS_116:The DLQ is on the source queue (terraform/v2), as SQS event sources require.
  #checkov:skip=CKV_AWS_117:The worker needs only public AWS endpoints; a VPC would need a NAT path.
  #checkov:skip=CKV_AWS_173:Environment holds names only; secrets stay in SSM.
  function_name                  = local.workers.invoice_parser_worker.name
  role                           = aws_iam_role.invoice_parser_worker.arn
  handler                        = "index.handler"
  runtime                        = "nodejs22.x"
  architectures                  = ["arm64"]
  timeout                        = local.workers.invoice_parser_worker.timeout
  memory_size                    = local.workers.invoice_parser_worker.memory_size
  reserved_concurrent_executions = local.workers.invoice_parser_worker.reserved
  publish                        = true
  filename                       = data.archive_file.worker_placeholder.output_path
  source_code_hash               = data.archive_file.worker_placeholder.output_base64sha256

  ephemeral_storage {
    size = 1024
  }

  environment {
    variables = merge(local.worker_environment, local.workers.invoice_parser_worker.extra_env)
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }

  depends_on = [aws_cloudwatch_log_group.invoice_parser_worker, aws_iam_role_policy.invoice_parser_worker]
}

resource "aws_lambda_alias" "invoice_parser_worker_live" {
  name             = "live"
  function_name    = aws_lambda_function.invoice_parser_worker.function_name
  function_version = aws_lambda_function.invoice_parser_worker.version

  lifecycle {
    ignore_changes = [function_version]
  }
}

resource "aws_lambda_event_source_mapping" "invoice_parser_worker" {
  event_source_arn                   = local.workers.invoice_parser_worker.queue_arn
  function_name                      = aws_lambda_alias.invoice_parser_worker_live.arn
  batch_size                         = 1
  function_response_types            = ["ReportBatchItemFailures"]
  maximum_batching_window_in_seconds = 0
}
