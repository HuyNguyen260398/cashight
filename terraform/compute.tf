# terraform/compute.tf — SSM parameters, Lambda IAM roles, functions, log groups, aliases

# ── Placeholder zip (real artifacts are uploaded by CI) ──────────────────────

data "archive_file" "placeholder" {
  type        = "zip"
  output_path = "${path.module}/.placeholder.zip"
  source {
    content  = "placeholder"
    filename = "index.js"
  }
}

# ── SSM Parameter Store (metadata only — real values set out of band) ─────────
#
# Standard-tier SecureString parameters are free; Secrets Manager charged $0.40
# per secret per month for the same job. Neither value needs rotation, staging
# labels, or cross-account sharing, so Parameter Store is the cheaper fit.
#
# `value` is a placeholder and is ignored on subsequent plans — the real values
# are written out of band (see docs/aws-cost-review-2026-07.md §8) so they never
# land in the repo or in Terraform state as a managed attribute.

resource "aws_ssm_parameter" "pdf_password" {
  name        = "/cashight/prod/pdf-password"
  description = "PDF statement password(s) for parser-worker; JSON map or plain string"
  type        = "SecureString"
  value       = "PLACEHOLDER — set out of band"

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "gemini_api_key" {
  name        = "/cashight/prod/gemini-api-key"
  description = "Gemini API key for summary-api"
  type        = "SecureString"
  value       = "PLACEHOLDER — set out of band"

  lifecycle {
    ignore_changes = [value]
  }
}

# NOTE: there is deliberately no google-oauth secret. Cognito's Google IdP takes
# its credentials from var.google_oauth_client_id / _client_secret (cognito.tf),
# so the secret that used to live here was never read by anything — no IAM grant
# referenced it and its LastAccessedDate was never set.

# ── Shared IAM building blocks ────────────────────────────────────────────────

data "aws_iam_policy_document" "lambda_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "xray_write" {
  statement {
    sid = "XRayWrite"
    actions = [
      "xray:PutTraceSegments",
      "xray:PutTelemetryRecords",
      "xray:GetSamplingRules",
      "xray:GetSamplingTargets",
    ]
    resources = ["*"]
  }
}

# ── auth-guard ────────────────────────────────────────────────────────────────

resource "aws_iam_role" "lambda_auth_guard" {
  name               = "cashight-auth-guard-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
  tags               = { Project = var.project_name }
}

resource "aws_iam_role_policy_attachment" "lambda_auth_guard_basic" {
  role       = aws_iam_role.lambda_auth_guard.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "lambda_auth_guard_xray" {
  name   = "xray-write"
  role   = aws_iam_role.lambda_auth_guard.id
  policy = data.aws_iam_policy_document.xray_write.json
}

data "aws_iam_policy_document" "lambda_auth_guard_permissions" {
  statement {
    sid       = "DynamoDBAccess"
    effect    = "Allow"
    actions   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem"]
    resources = [aws_dynamodb_table.cashight.arn]
  }
}

resource "aws_iam_role_policy" "lambda_auth_guard_permissions" {
  name   = "permissions"
  role   = aws_iam_role.lambda_auth_guard.id
  policy = data.aws_iam_policy_document.lambda_auth_guard_permissions.json
}

resource "aws_cloudwatch_log_group" "lambda_auth_guard" {
  name              = "/aws/lambda/cashight-auth-guard"
  retention_in_days = 30
}

resource "aws_lambda_function" "auth_guard" {
  function_name    = "cashight-auth-guard"
  role             = aws_iam_role.lambda_auth_guard.arn
  handler          = "index.handler"
  runtime          = "nodejs22.x"
  timeout          = 30
  memory_size      = 256
  publish          = true
  filename         = data.archive_file.placeholder.output_path
  source_code_hash = data.archive_file.placeholder.output_base64sha256

  environment {
    variables = {
      TABLE_NAME    = aws_dynamodb_table.cashight.name
      ALLOWED_EMAIL = var.allowed_email
    }
  }

  tracing_config {
    mode = "Active"
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }

  depends_on = [aws_cloudwatch_log_group.lambda_auth_guard]
}

resource "aws_lambda_alias" "auth_guard_live" {
  name             = "live"
  function_name    = aws_lambda_function.auth_guard.function_name
  function_version = aws_lambda_function.auth_guard.version

  lifecycle {
    ignore_changes = [function_version]
  }
}

# ── session-capabilities-api ─────────────────────────────────────────────────

resource "aws_iam_role" "lambda_session_capabilities_api" {
  name               = "cashight-session-capabilities-api-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
  tags               = { Project = var.project_name }
}

resource "aws_iam_role_policy_attachment" "lambda_session_capabilities_api_basic" {
  role       = aws_iam_role.lambda_session_capabilities_api.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "lambda_session_capabilities_api_xray" {
  name   = "xray-write"
  role   = aws_iam_role.lambda_session_capabilities_api.id
  policy = data.aws_iam_policy_document.xray_write.json
}

data "aws_iam_policy_document" "lambda_session_capabilities_api_permissions" {
  statement {
    sid       = "ReadAuthorizationRecord"
    effect    = "Allow"
    actions   = ["dynamodb:GetItem"]
    resources = [aws_dynamodb_table.cashight.arn]
  }
}

resource "aws_iam_role_policy" "lambda_session_capabilities_api_permissions" {
  name   = "permissions"
  role   = aws_iam_role.lambda_session_capabilities_api.id
  policy = data.aws_iam_policy_document.lambda_session_capabilities_api_permissions.json
}

resource "aws_cloudwatch_log_group" "lambda_session_capabilities_api" {
  name              = "/aws/lambda/cashight-session-capabilities-api"
  retention_in_days = 30
}

resource "aws_lambda_function" "session_capabilities_api" {
  function_name    = "cashight-session-capabilities-api"
  role             = aws_iam_role.lambda_session_capabilities_api.arn
  handler          = "index.handler"
  runtime          = "nodejs22.x"
  timeout          = 10
  memory_size      = 256
  publish          = true
  filename         = data.archive_file.placeholder.output_path
  source_code_hash = data.archive_file.placeholder.output_base64sha256

  environment {
    variables = {
      TABLE_NAME                   = aws_dynamodb_table.cashight.name
      ENABLE_LEGACY_AUTHZ_FALLBACK = tostring(var.enable_legacy_authz_fallback)
    }
  }

  tracing_config {
    mode = "Active"
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }

  depends_on = [aws_cloudwatch_log_group.lambda_session_capabilities_api]
}

resource "aws_lambda_alias" "session_capabilities_api_live" {
  name             = "live"
  function_name    = aws_lambda_function.session_capabilities_api.function_name
  function_version = aws_lambda_function.session_capabilities_api.version

  lifecycle {
    ignore_changes = [function_version]
  }
}

# ── cost-explorer-api ─────────────────────────────────────────────────────────

resource "aws_iam_role" "lambda_cost_explorer_api" {
  name               = "cashight-cost-explorer-api-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
  tags               = { Project = var.project_name }
}

resource "aws_iam_role_policy_attachment" "lambda_cost_explorer_api_basic" {
  role       = aws_iam_role.lambda_cost_explorer_api.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "lambda_cost_explorer_api_xray" {
  name   = "xray-write"
  role   = aws_iam_role.lambda_cost_explorer_api.id
  policy = data.aws_iam_policy_document.xray_write.json
}

data "aws_iam_policy_document" "lambda_cost_explorer_api_permissions" {
  statement {
    sid    = "CostExplorerRead"
    effect = "Allow"
    actions = [
      "ce:GetCostAndUsage",
      "ce:GetCostAndUsageWithResources",
      "ce:GetCostForecast",
      "ce:GetUsageForecast",
      "ce:GetDimensionValues",
      "ce:GetTags",
      "ce:GetCostCategories",
      "ce:GetCostAndUsageComparisons",
      "ce:GetCostComparisonDrivers",
    ]
    resources = [
      "arn:aws:billing::${data.aws_caller_identity.current.account_id}:billingview/*",
    ]
  }

  statement {
    sid       = "BillingList"
    effect    = "Allow"
    actions   = ["billing:ListBillingViews"]
    resources = ["*"]
  }

  statement {
    sid       = "BillingViewRead"
    effect    = "Allow"
    actions   = ["billing:GetBillingView"]
    resources = ["arn:aws:billing::${data.aws_caller_identity.current.account_id}:billingview/*"]
  }

  statement {
    sid       = "ViewBilling"
    effect    = "Allow"
    actions   = ["aws-portal:ViewBilling"]
    resources = ["*"]
  }

  statement {
    sid    = "DynamoDBItems"
    effect = "Allow"
    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:DeleteItem",
      "dynamodb:Query",
      "dynamodb:TransactWriteItems",
    ]
    resources = [aws_dynamodb_table.cashight.arn]
  }

  statement {
    sid       = "PrivateCsvExports"
    effect    = "Allow"
    actions   = ["s3:GetObject", "s3:PutObject"]
    resources = ["${aws_s3_bucket.cost_exports.arn}/exports/*"]
  }
}

resource "aws_iam_role_policy" "lambda_cost_explorer_api_permissions" {
  name   = "permissions"
  role   = aws_iam_role.lambda_cost_explorer_api.id
  policy = data.aws_iam_policy_document.lambda_cost_explorer_api_permissions.json
}

resource "aws_cloudwatch_log_group" "lambda_cost_explorer_api" {
  #checkov:skip=CKV_AWS_158:Logs contain sanitized operational metadata only; AWS-managed encryption is sufficient for the required 30-day retention.
  #checkov:skip=CKV_AWS_338:The Task 7 contract deliberately limits operational logs to 30 days for privacy and cost control.
  name              = "/aws/lambda/cashight-cost-explorer-api"
  retention_in_days = 30
  tags              = { Project = var.project_name }
}

resource "aws_lambda_function" "cost_explorer_api" {
  #checkov:skip=CKV_AWS_116:Synchronous API Gateway requests return typed failures to callers; an asynchronous DLQ is not applicable.
  #checkov:skip=CKV_AWS_117:The Lambda calls public AWS Cost Explorer endpoints and needs no private resources; a VPC would require costly NAT egress.
  #checkov:skip=CKV_AWS_173:Environment values are resource identifiers and boolean feature flags, never secrets.
  #checkov:skip=CKV_AWS_272:Lambda publishes immutable versions behind a live alias; code-signing configuration is not established in the repository deployment standard.
  function_name                  = "cashight-cost-explorer-api"
  role                           = aws_iam_role.lambda_cost_explorer_api.arn
  handler                        = "index.handler"
  runtime                        = "nodejs22.x"
  timeout                        = 28
  memory_size                    = 1024
  reserved_concurrent_executions = 2
  publish                        = true
  filename                       = data.archive_file.placeholder.output_path
  source_code_hash               = data.archive_file.placeholder.output_base64sha256

  environment {
    variables = {
      TABLE_NAME                   = aws_dynamodb_table.cashight.name
      EXPORT_BUCKET                = aws_s3_bucket.cost_exports.bucket
      GRANULAR_DATA_ENABLED        = tostring(var.enable_cost_explorer_granular_data)
      ENABLE_LEGACY_AUTHZ_FALLBACK = tostring(var.enable_legacy_authz_fallback)
    }
  }

  tracing_config {
    mode = "Active"
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]

    precondition {
      condition = (
        !var.enable_cost_explorer_granular_data ||
        var.cost_explorer_granular_data_enabled_out_of_band
      )
      error_message = "Granular Cost Explorer data may be enabled only after the operator confirms the AWS account preference was enabled out of band."
    }
  }

  depends_on = [aws_cloudwatch_log_group.lambda_cost_explorer_api]
}

resource "aws_lambda_alias" "cost_explorer_api_live" {
  name             = "live"
  function_name    = aws_lambda_function.cost_explorer_api.function_name
  function_version = aws_lambda_function.cost_explorer_api.version

  lifecycle {
    ignore_changes = [function_version]
  }
}

# ── uploads-api ───────────────────────────────────────────────────────────────

resource "aws_iam_role" "lambda_uploads_api" {
  name               = "cashight-uploads-api-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
  tags               = { Project = var.project_name }
}

resource "aws_iam_role_policy_attachment" "lambda_uploads_api_basic" {
  role       = aws_iam_role.lambda_uploads_api.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "lambda_uploads_api_xray" {
  name   = "xray-write"
  role   = aws_iam_role.lambda_uploads_api.id
  policy = data.aws_iam_policy_document.xray_write.json
}

data "aws_iam_policy_document" "lambda_uploads_api_permissions" {
  statement {
    sid       = "S3PutUploads"
    effect    = "Allow"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.uploads.arn}/uploads/*"]
  }
  statement {
    sid       = "DynamoDBAccess"
    effect    = "Allow"
    actions   = ["dynamodb:PutItem", "dynamodb:GetItem"]
    resources = [aws_dynamodb_table.cashight.arn]
  }
}

resource "aws_iam_role_policy" "lambda_uploads_api_permissions" {
  name   = "permissions"
  role   = aws_iam_role.lambda_uploads_api.id
  policy = data.aws_iam_policy_document.lambda_uploads_api_permissions.json
}

resource "aws_cloudwatch_log_group" "lambda_uploads_api" {
  name              = "/aws/lambda/cashight-uploads-api"
  retention_in_days = 30
}

resource "aws_lambda_function" "uploads_api" {
  function_name    = "cashight-uploads-api"
  role             = aws_iam_role.lambda_uploads_api.arn
  handler          = "index.handler"
  runtime          = "nodejs22.x"
  timeout          = 30
  memory_size      = 256
  publish          = true
  filename         = data.archive_file.placeholder.output_path
  source_code_hash = data.archive_file.placeholder.output_base64sha256

  environment {
    variables = {
      TABLE_NAME                   = aws_dynamodb_table.cashight.name
      UPLOAD_BUCKET                = aws_s3_bucket.uploads.bucket
      ENABLE_LEGACY_AUTHZ_FALLBACK = tostring(var.enable_legacy_authz_fallback)
    }
  }

  tracing_config {
    mode = "Active"
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }

  depends_on = [aws_cloudwatch_log_group.lambda_uploads_api]
}

resource "aws_lambda_alias" "uploads_api_live" {
  name             = "live"
  function_name    = aws_lambda_function.uploads_api.function_name
  function_version = aws_lambda_function.uploads_api.version

  lifecycle {
    ignore_changes = [function_version]
  }
}

# ── upload-status-api ─────────────────────────────────────────────────────────

resource "aws_iam_role" "lambda_upload_status_api" {
  name               = "cashight-upload-status-api-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
  tags               = { Project = var.project_name }
}

resource "aws_iam_role_policy_attachment" "lambda_upload_status_api_basic" {
  role       = aws_iam_role.lambda_upload_status_api.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "lambda_upload_status_api_xray" {
  name   = "xray-write"
  role   = aws_iam_role.lambda_upload_status_api.id
  policy = data.aws_iam_policy_document.xray_write.json
}

data "aws_iam_policy_document" "lambda_upload_status_api_permissions" {
  statement {
    sid       = "DynamoDBAccess"
    effect    = "Allow"
    actions   = ["dynamodb:GetItem"]
    resources = [aws_dynamodb_table.cashight.arn]
  }
}

resource "aws_iam_role_policy" "lambda_upload_status_api_permissions" {
  name   = "permissions"
  role   = aws_iam_role.lambda_upload_status_api.id
  policy = data.aws_iam_policy_document.lambda_upload_status_api_permissions.json
}

resource "aws_cloudwatch_log_group" "lambda_upload_status_api" {
  name              = "/aws/lambda/cashight-upload-status-api"
  retention_in_days = 30
}

resource "aws_lambda_function" "upload_status_api" {
  function_name    = "cashight-upload-status-api"
  role             = aws_iam_role.lambda_upload_status_api.arn
  handler          = "index.handler"
  runtime          = "nodejs22.x"
  timeout          = 30
  memory_size      = 256
  publish          = true
  filename         = data.archive_file.placeholder.output_path
  source_code_hash = data.archive_file.placeholder.output_base64sha256

  environment {
    variables = {
      TABLE_NAME                       = aws_dynamodb_table.cashight.name
      ENABLE_LEGACY_AUTHZ_FALLBACK     = tostring(var.enable_legacy_authz_fallback)
      ENABLE_LEGACY_WORKSPACE_FALLBACK = tostring(var.enable_legacy_workspace_fallback)
    }
  }

  tracing_config {
    mode = "Active"
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }

  depends_on = [aws_cloudwatch_log_group.lambda_upload_status_api]
}

resource "aws_lambda_alias" "upload_status_api_live" {
  name             = "live"
  function_name    = aws_lambda_function.upload_status_api.function_name
  function_version = aws_lambda_function.upload_status_api.version

  lifecycle {
    ignore_changes = [function_version]
  }
}

# ── parser-worker ─────────────────────────────────────────────────────────────

resource "aws_iam_role" "lambda_parser_worker" {
  name               = "cashight-parser-worker-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
  tags               = { Project = var.project_name }
}

resource "aws_iam_role_policy_attachment" "lambda_parser_worker_basic" {
  role       = aws_iam_role.lambda_parser_worker.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "lambda_parser_worker_xray" {
  name   = "xray-write"
  role   = aws_iam_role.lambda_parser_worker.id
  policy = data.aws_iam_policy_document.xray_write.json
}

data "aws_iam_policy_document" "lambda_parser_worker_permissions" {
  statement {
    sid       = "S3ReadDeleteUploads"
    effect    = "Allow"
    actions   = ["s3:GetObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.uploads.arn}/uploads/*"]
  }
  statement {
    sid       = "S3ReadWriteStatements"
    effect    = "Allow"
    actions   = ["s3:PutObject", "s3:GetObject", "s3:HeadObject"]
    resources = ["${aws_s3_bucket.statements.arn}/users/*"]
  }
  statement {
    sid    = "DynamoDBAccess"
    effect = "Allow"
    actions = [
      "dynamodb:PutItem",
      "dynamodb:GetItem",
      "dynamodb:UpdateItem",
      "dynamodb:DeleteItem",
    ]
    resources = [aws_dynamodb_table.cashight.arn]
  }
  statement {
    sid       = "GetPdfPassword"
    effect    = "Allow"
    actions   = ["ssm:GetParameter"]
    resources = [aws_ssm_parameter.pdf_password.arn]
  }
  statement {
    sid    = "SQSConsume"
    effect = "Allow"
    actions = [
      "sqs:ReceiveMessage",
      "sqs:DeleteMessage",
      "sqs:GetQueueAttributes",
      "sqs:ChangeMessageVisibility",
    ]
    resources = [aws_sqs_queue.parse.arn]
  }
}

resource "aws_iam_role_policy" "lambda_parser_worker_permissions" {
  name   = "permissions"
  role   = aws_iam_role.lambda_parser_worker.id
  policy = data.aws_iam_policy_document.lambda_parser_worker_permissions.json
}

resource "aws_cloudwatch_log_group" "lambda_parser_worker" {
  name              = "/aws/lambda/cashight-parser-worker"
  retention_in_days = 30
}

resource "aws_lambda_function" "parser_worker" {
  function_name                  = "cashight-parser-worker"
  role                           = aws_iam_role.lambda_parser_worker.arn
  handler                        = "index.handler"
  runtime                        = "nodejs22.x"
  timeout                        = 120
  memory_size                    = 1536
  reserved_concurrent_executions = 2
  publish                        = true
  filename                       = data.archive_file.placeholder.output_path
  source_code_hash               = data.archive_file.placeholder.output_base64sha256

  ephemeral_storage {
    size = 1024
  }

  environment {
    variables = {
      TABLE_NAME                       = aws_dynamodb_table.cashight.name
      UPLOAD_BUCKET                    = aws_s3_bucket.uploads.bucket
      STATEMENTS_BUCKET                = aws_s3_bucket.statements.bucket
      PDF_PASSWORD_PARAM               = aws_ssm_parameter.pdf_password.name
      ENABLE_LEGACY_WORKSPACE_FALLBACK = tostring(var.enable_legacy_workspace_fallback)
    }
  }

  tracing_config {
    mode = "Active"
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }

  depends_on = [aws_cloudwatch_log_group.lambda_parser_worker]
}

resource "aws_lambda_alias" "parser_worker_live" {
  name             = "live"
  function_name    = aws_lambda_function.parser_worker.function_name
  function_version = aws_lambda_function.parser_worker.version

  lifecycle {
    ignore_changes = [function_version]
  }
}

# ── SQS event source mapping for parser-worker ────────────────────────────────

resource "aws_lambda_event_source_mapping" "parser_worker_sqs" {
  event_source_arn                   = aws_sqs_queue.parse.arn
  function_name                      = aws_lambda_alias.parser_worker_live.arn
  batch_size                         = 1
  function_response_types            = ["ReportBatchItemFailures"]
  maximum_batching_window_in_seconds = 0
}

# ── statements-api ────────────────────────────────────────────────────────────

resource "aws_iam_role" "lambda_statements_api" {
  name               = "cashight-statements-api-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
  tags               = { Project = var.project_name }
}

resource "aws_iam_role_policy_attachment" "lambda_statements_api_basic" {
  role       = aws_iam_role.lambda_statements_api.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "lambda_statements_api_xray" {
  name   = "xray-write"
  role   = aws_iam_role.lambda_statements_api.id
  policy = data.aws_iam_policy_document.xray_write.json
}

data "aws_iam_policy_document" "lambda_statements_api_permissions" {
  statement {
    sid       = "S3ReadDeleteStatements"
    effect    = "Allow"
    actions   = ["s3:GetObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.statements.arn}/users/*"]
  }
  statement {
    sid       = "DynamoDBAccess"
    effect    = "Allow"
    actions   = ["dynamodb:Query", "dynamodb:GetItem", "dynamodb:DeleteItem"]
    resources = [aws_dynamodb_table.cashight.arn]
  }
}

resource "aws_iam_role_policy" "lambda_statements_api_permissions" {
  name   = "permissions"
  role   = aws_iam_role.lambda_statements_api.id
  policy = data.aws_iam_policy_document.lambda_statements_api_permissions.json
}

resource "aws_cloudwatch_log_group" "lambda_statements_api" {
  name              = "/aws/lambda/cashight-statements-api"
  retention_in_days = 30
}

resource "aws_lambda_function" "statements_api" {
  function_name    = "cashight-statements-api"
  role             = aws_iam_role.lambda_statements_api.arn
  handler          = "index.handler"
  runtime          = "nodejs22.x"
  timeout          = 30
  memory_size      = 256
  publish          = true
  filename         = data.archive_file.placeholder.output_path
  source_code_hash = data.archive_file.placeholder.output_base64sha256

  environment {
    variables = {
      TABLE_NAME                       = aws_dynamodb_table.cashight.name
      STATEMENTS_BUCKET                = aws_s3_bucket.statements.bucket
      ENABLE_LEGACY_AUTHZ_FALLBACK     = tostring(var.enable_legacy_authz_fallback)
      ENABLE_LEGACY_WORKSPACE_FALLBACK = tostring(var.enable_legacy_workspace_fallback)
    }
  }

  tracing_config {
    mode = "Active"
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }

  depends_on = [aws_cloudwatch_log_group.lambda_statements_api]
}

resource "aws_lambda_alias" "statements_api_live" {
  name             = "live"
  function_name    = aws_lambda_function.statements_api.function_name
  function_version = aws_lambda_function.statements_api.version

  lifecycle {
    ignore_changes = [function_version]
  }
}

# ── dashboard-api ─────────────────────────────────────────────────────────────

resource "aws_iam_role" "lambda_dashboard_api" {
  name               = "cashight-dashboard-api-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
  tags               = { Project = var.project_name }
}

resource "aws_iam_role_policy_attachment" "lambda_dashboard_api_basic" {
  role       = aws_iam_role.lambda_dashboard_api.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "lambda_dashboard_api_xray" {
  name   = "xray-write"
  role   = aws_iam_role.lambda_dashboard_api.id
  policy = data.aws_iam_policy_document.xray_write.json
}

data "aws_iam_policy_document" "lambda_dashboard_api_permissions" {
  statement {
    sid       = "S3ReadStatements"
    effect    = "Allow"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.statements.arn}/users/*"]
  }
  statement {
    sid       = "DynamoDBAccess"
    effect    = "Allow"
    actions   = ["dynamodb:Query", "dynamodb:GetItem"]
    resources = [aws_dynamodb_table.cashight.arn]
  }
}

resource "aws_iam_role_policy" "lambda_dashboard_api_permissions" {
  name   = "permissions"
  role   = aws_iam_role.lambda_dashboard_api.id
  policy = data.aws_iam_policy_document.lambda_dashboard_api_permissions.json
}

resource "aws_cloudwatch_log_group" "lambda_dashboard_api" {
  name              = "/aws/lambda/cashight-dashboard-api"
  retention_in_days = 30
}

resource "aws_lambda_function" "dashboard_api" {
  function_name    = "cashight-dashboard-api"
  role             = aws_iam_role.lambda_dashboard_api.arn
  handler          = "index.handler"
  runtime          = "nodejs22.x"
  timeout          = 30
  memory_size      = 256
  publish          = true
  filename         = data.archive_file.placeholder.output_path
  source_code_hash = data.archive_file.placeholder.output_base64sha256

  environment {
    variables = {
      TABLE_NAME                       = aws_dynamodb_table.cashight.name
      STATEMENTS_BUCKET                = aws_s3_bucket.statements.bucket
      ENABLE_LEGACY_AUTHZ_FALLBACK     = tostring(var.enable_legacy_authz_fallback)
      ENABLE_LEGACY_WORKSPACE_FALLBACK = tostring(var.enable_legacy_workspace_fallback)
    }
  }

  tracing_config {
    mode = "Active"
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }

  depends_on = [aws_cloudwatch_log_group.lambda_dashboard_api]
}

resource "aws_lambda_alias" "dashboard_api_live" {
  name             = "live"
  function_name    = aws_lambda_function.dashboard_api.function_name
  function_version = aws_lambda_function.dashboard_api.version

  lifecycle {
    ignore_changes = [function_version]
  }
}

# ── summary-api ───────────────────────────────────────────────────────────────

resource "aws_iam_role" "lambda_summary_api" {
  name               = "cashight-summary-api-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
  tags               = { Project = var.project_name }
}

resource "aws_iam_role_policy_attachment" "lambda_summary_api_basic" {
  role       = aws_iam_role.lambda_summary_api.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "lambda_summary_api_xray" {
  name   = "xray-write"
  role   = aws_iam_role.lambda_summary_api.id
  policy = data.aws_iam_policy_document.xray_write.json
}

data "aws_iam_policy_document" "lambda_summary_api_permissions" {
  statement {
    sid       = "S3ReadStatements"
    effect    = "Allow"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.statements.arn}/users/*"]
  }
  statement {
    sid       = "DynamoDBAccess"
    effect    = "Allow"
    actions   = ["dynamodb:GetItem"]
    resources = [aws_dynamodb_table.cashight.arn]
  }
  statement {
    sid       = "GetGeminiKey"
    effect    = "Allow"
    actions   = ["ssm:GetParameter"]
    resources = [aws_ssm_parameter.gemini_api_key.arn]
  }
}

resource "aws_iam_role_policy" "lambda_summary_api_permissions" {
  name   = "permissions"
  role   = aws_iam_role.lambda_summary_api.id
  policy = data.aws_iam_policy_document.lambda_summary_api_permissions.json
}

resource "aws_cloudwatch_log_group" "lambda_summary_api" {
  name              = "/aws/lambda/cashight-summary-api"
  retention_in_days = 30
}

resource "aws_lambda_function" "summary_api" {
  function_name                  = "cashight-summary-api"
  role                           = aws_iam_role.lambda_summary_api.arn
  handler                        = "index.handler"
  runtime                        = "nodejs22.x"
  timeout                        = 120
  memory_size                    = 1024
  reserved_concurrent_executions = 2
  publish                        = true
  filename                       = data.archive_file.placeholder.output_path
  source_code_hash               = data.archive_file.placeholder.output_base64sha256

  environment {
    variables = {
      TABLE_NAME                   = aws_dynamodb_table.cashight.name
      STATEMENTS_BUCKET            = aws_s3_bucket.statements.bucket
      GEMINI_PARAM                 = aws_ssm_parameter.gemini_api_key.name
      ENABLE_LEGACY_AUTHZ_FALLBACK = tostring(var.enable_legacy_authz_fallback)
    }
  }

  tracing_config {
    mode = "Active"
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }

  depends_on = [aws_cloudwatch_log_group.lambda_summary_api]
}

resource "aws_lambda_alias" "summary_api_live" {
  name             = "live"
  function_name    = aws_lambda_function.summary_api.function_name
  function_version = aws_lambda_function.summary_api.version

  lifecycle {
    ignore_changes = [function_version]
  }
}

# ── Lambda invoke permissions ─────────────────────────────────────────────────

# Cognito may invoke auth-guard (e.g. pre-token-generation or post-authentication
# triggers). The Cognito pool ARN is known at this point.
resource "aws_lambda_permission" "cognito_auth_guard" {
  statement_id  = "AllowCognito"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.auth_guard.function_name
  qualifier     = aws_lambda_alias.auth_guard_live.name
  principal     = "cognito-idp.amazonaws.com"
  source_arn    = aws_cognito_user_pool.users.arn
}

# API Gateway invoke permissions for the API functions are
# added in Task 12 once aws_apigatewayv2_api.cashight is provisioned and its
# execution ARN is known.

# ── CodeDeploy ────────────────────────────────────────────────────────────────

data "aws_iam_policy_document" "codedeploy_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["codedeploy.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "codedeploy" {
  name               = "cashight-codedeploy"
  assume_role_policy = data.aws_iam_policy_document.codedeploy_assume_role.json
}

resource "aws_iam_role_policy_attachment" "codedeploy_lambda" {
  role       = aws_iam_role.codedeploy.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSCodeDeployRoleForLambda"
}

# auth-guard
resource "aws_codedeploy_app" "auth_guard" {
  name             = "cashight-auth-guard"
  compute_platform = "Lambda"
}

resource "aws_codedeploy_deployment_group" "auth_guard" {
  app_name              = aws_codedeploy_app.auth_guard.name
  deployment_group_name = "cashight-auth-guard-live"
  service_role_arn      = aws_iam_role.codedeploy.arn

  deployment_config_name = "CodeDeployDefault.LambdaCanary10Percent5Minutes"

  deployment_style {
    deployment_option = "WITH_TRAFFIC_CONTROL"
    deployment_type   = "BLUE_GREEN"
  }

  auto_rollback_configuration {
    enabled = true
    events  = ["DEPLOYMENT_FAILURE"]
  }
}

# session-capabilities-api
resource "aws_codedeploy_app" "session_capabilities_api" {
  name             = "cashight-session-capabilities-api"
  compute_platform = "Lambda"
}

resource "aws_codedeploy_deployment_group" "session_capabilities_api" {
  app_name              = aws_codedeploy_app.session_capabilities_api.name
  deployment_group_name = "cashight-session-capabilities-api-live"
  service_role_arn      = aws_iam_role.codedeploy.arn

  deployment_config_name = "CodeDeployDefault.LambdaCanary10Percent5Minutes"

  deployment_style {
    deployment_option = "WITH_TRAFFIC_CONTROL"
    deployment_type   = "BLUE_GREEN"
  }

  auto_rollback_configuration {
    enabled = true
    events  = ["DEPLOYMENT_FAILURE"]
  }
}

# cost-explorer-api
resource "aws_codedeploy_app" "cost_explorer_api" {
  name             = "cashight-cost-explorer-api"
  compute_platform = "Lambda"
}

resource "aws_codedeploy_deployment_group" "cost_explorer_api" {
  app_name              = aws_codedeploy_app.cost_explorer_api.name
  deployment_group_name = "cashight-cost-explorer-api-live"
  service_role_arn      = aws_iam_role.codedeploy.arn

  deployment_config_name = "CodeDeployDefault.LambdaCanary10Percent5Minutes"

  deployment_style {
    deployment_option = "WITH_TRAFFIC_CONTROL"
    deployment_type   = "BLUE_GREEN"
  }

  auto_rollback_configuration {
    enabled = true
    events  = ["DEPLOYMENT_FAILURE"]
  }
}

# uploads-api
resource "aws_codedeploy_app" "uploads_api" {
  name             = "cashight-uploads-api"
  compute_platform = "Lambda"
}

resource "aws_codedeploy_deployment_group" "uploads_api" {
  app_name              = aws_codedeploy_app.uploads_api.name
  deployment_group_name = "cashight-uploads-api-live"
  service_role_arn      = aws_iam_role.codedeploy.arn

  deployment_config_name = "CodeDeployDefault.LambdaCanary10Percent5Minutes"

  deployment_style {
    deployment_option = "WITH_TRAFFIC_CONTROL"
    deployment_type   = "BLUE_GREEN"
  }

  auto_rollback_configuration {
    enabled = true
    events  = ["DEPLOYMENT_FAILURE"]
  }
}

# upload-status-api
resource "aws_codedeploy_app" "upload_status_api" {
  name             = "cashight-upload-status-api"
  compute_platform = "Lambda"
}

resource "aws_codedeploy_deployment_group" "upload_status_api" {
  app_name              = aws_codedeploy_app.upload_status_api.name
  deployment_group_name = "cashight-upload-status-api-live"
  service_role_arn      = aws_iam_role.codedeploy.arn

  deployment_config_name = "CodeDeployDefault.LambdaCanary10Percent5Minutes"

  deployment_style {
    deployment_option = "WITH_TRAFFIC_CONTROL"
    deployment_type   = "BLUE_GREEN"
  }

  auto_rollback_configuration {
    enabled = true
    events  = ["DEPLOYMENT_FAILURE"]
  }
}

# parser-worker
resource "aws_codedeploy_app" "parser_worker" {
  name             = "cashight-parser-worker"
  compute_platform = "Lambda"
}

resource "aws_codedeploy_deployment_group" "parser_worker" {
  app_name              = aws_codedeploy_app.parser_worker.name
  deployment_group_name = "cashight-parser-worker-live"
  service_role_arn      = aws_iam_role.codedeploy.arn

  deployment_config_name = "CodeDeployDefault.LambdaCanary10Percent5Minutes"

  deployment_style {
    deployment_option = "WITH_TRAFFIC_CONTROL"
    deployment_type   = "BLUE_GREEN"
  }

  auto_rollback_configuration {
    enabled = true
    events  = ["DEPLOYMENT_FAILURE"]
  }
}

# statements-api
resource "aws_codedeploy_app" "statements_api" {
  name             = "cashight-statements-api"
  compute_platform = "Lambda"
}

resource "aws_codedeploy_deployment_group" "statements_api" {
  app_name              = aws_codedeploy_app.statements_api.name
  deployment_group_name = "cashight-statements-api-live"
  service_role_arn      = aws_iam_role.codedeploy.arn

  deployment_config_name = "CodeDeployDefault.LambdaCanary10Percent5Minutes"

  deployment_style {
    deployment_option = "WITH_TRAFFIC_CONTROL"
    deployment_type   = "BLUE_GREEN"
  }

  auto_rollback_configuration {
    enabled = true
    events  = ["DEPLOYMENT_FAILURE"]
  }
}

# dashboard-api
resource "aws_codedeploy_app" "dashboard_api" {
  name             = "cashight-dashboard-api"
  compute_platform = "Lambda"
}

resource "aws_codedeploy_deployment_group" "dashboard_api" {
  app_name              = aws_codedeploy_app.dashboard_api.name
  deployment_group_name = "cashight-dashboard-api-live"
  service_role_arn      = aws_iam_role.codedeploy.arn

  deployment_config_name = "CodeDeployDefault.LambdaCanary10Percent5Minutes"

  deployment_style {
    deployment_option = "WITH_TRAFFIC_CONTROL"
    deployment_type   = "BLUE_GREEN"
  }

  auto_rollback_configuration {
    enabled = true
    events  = ["DEPLOYMENT_FAILURE"]
  }
}

# summary-api
resource "aws_codedeploy_app" "summary_api" {
  name             = "cashight-summary-api"
  compute_platform = "Lambda"
}

resource "aws_codedeploy_deployment_group" "summary_api" {
  app_name              = aws_codedeploy_app.summary_api.name
  deployment_group_name = "cashight-summary-api-live"
  service_role_arn      = aws_iam_role.codedeploy.arn

  deployment_config_name = "CodeDeployDefault.LambdaCanary10Percent5Minutes"

  deployment_style {
    deployment_option = "WITH_TRAFFIC_CONTROL"
    deployment_type   = "BLUE_GREEN"
  }

  auto_rollback_configuration {
    enabled = true
    events  = ["DEPLOYMENT_FAILURE"]
  }
}
