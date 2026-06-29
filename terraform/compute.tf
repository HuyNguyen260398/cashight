# terraform/compute.tf — Secrets Manager, Lambda IAM roles, functions, log groups, aliases

# ── Placeholder zip (real artifacts are uploaded by CI) ──────────────────────

data "archive_file" "placeholder" {
  type        = "zip"
  output_path = "${path.module}/.placeholder.zip"
  source {
    content  = "placeholder"
    filename = "index.js"
  }
}

# ── Secrets Manager (metadata only — no secret versions committed) ────────────

resource "aws_secretsmanager_secret" "pdf_password" {
  name                    = "/cashight/prod/pdf-password"
  description             = "PDF statement password for parser-worker"
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret" "gemini_api_key" {
  name                    = "/cashight/prod/gemini-api-key"
  description             = "Gemini API key for summary-api"
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret" "google_oauth" {
  name                    = "/cashight/prod/google-oauth"
  description             = "Google OAuth client credentials for Cognito IdP"
  recovery_window_in_days = 7
}

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
    actions   = ["dynamodb:GetItem", "dynamodb:PutItem"]
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
      TABLE_NAME    = aws_dynamodb_table.cashight.name
      UPLOAD_BUCKET = aws_s3_bucket.uploads.bucket
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
      TABLE_NAME = aws_dynamodb_table.cashight.name
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
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.pdf_password.arn]
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
      TABLE_NAME             = aws_dynamodb_table.cashight.name
      UPLOAD_BUCKET          = aws_s3_bucket.uploads.bucket
      STATEMENTS_BUCKET      = aws_s3_bucket.statements.bucket
      PDF_PASSWORD_SECRET_ID = aws_secretsmanager_secret.pdf_password.arn
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
      TABLE_NAME        = aws_dynamodb_table.cashight.name
      STATEMENTS_BUCKET = aws_s3_bucket.statements.bucket
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
    actions   = ["dynamodb:Query"]
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
      TABLE_NAME        = aws_dynamodb_table.cashight.name
      STATEMENTS_BUCKET = aws_s3_bucket.statements.bucket
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
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.gemini_api_key.arn]
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
      TABLE_NAME        = aws_dynamodb_table.cashight.name
      STATEMENTS_BUCKET = aws_s3_bucket.statements.bucket
      GEMINI_SECRET_ID  = aws_secretsmanager_secret.gemini_api_key.arn
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

# API Gateway invoke permissions for the remaining 5 API functions will be
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
