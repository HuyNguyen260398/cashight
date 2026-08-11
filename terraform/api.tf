# terraform/api.tf — REST API Gateway, WAF association, custom domain, Route 53
# All Lambda permissions for API Gateway (SEC-008) are added here once the
# execution ARN is known.

locals {
  api_template_vars = {
    region                       = var.region
    user_pool_arn                = aws_cognito_user_pool.users.arn
    session_capabilities_api_arn = aws_lambda_alias.session_capabilities_api_live.arn
    cost_explorer_api_arn        = aws_lambda_alias.cost_explorer_api_live.arn
    uploads_api_arn              = aws_lambda_alias.uploads_api_live.arn
    upload_status_api_arn        = aws_lambda_alias.upload_status_api_live.arn
    statements_api_arn           = aws_lambda_alias.statements_api_live.arn
    dashboard_api_arn            = aws_lambda_alias.dashboard_api_live.arn
    summary_api_arn              = aws_lambda_alias.summary_api_live.arn
    aws_invoices_api_arn         = aws_lambda_alias.aws_invoices_api_live.arn
    aws_invoice_summary_api_arn  = aws_lambda_alias.aws_invoice_summary_api_live.arn
  }
}

# ── REST API (body from OpenAPI template) ────────────────────────────────────

resource "aws_api_gateway_rest_api" "cashight" {
  name        = "${var.project_name}-api"
  description = "Cashight REST API — session capabilities, statements, dashboard, uploads, summaries, AWS costs"

  body = templatefile("${path.module}/api-openapi.yaml.tftpl", local.api_template_vars)

  endpoint_configuration {
    types = ["REGIONAL"]
  }

  tags = {
    Project = var.project_name
  }
}

# ── Deployment and stage ──────────────────────────────────────────────────────

resource "aws_api_gateway_deployment" "cashight" {
  rest_api_id = aws_api_gateway_rest_api.cashight.id

  # Hash the rendered template body so any route/integration change triggers
  # a new deployment automatically.
  triggers = {
    redeployment = sha1(templatefile("${path.module}/api-openapi.yaml.tftpl", local.api_template_vars))
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_cloudwatch_log_group" "api_access_logs" {
  name              = "/aws/apigateway/${var.project_name}"
  retention_in_days = 30
  tags              = { Project = var.project_name }
}

resource "aws_api_gateway_stage" "prod" {
  rest_api_id   = aws_api_gateway_rest_api.cashight.id
  deployment_id = aws_api_gateway_deployment.cashight.id
  stage_name    = "prod"

  xray_tracing_enabled = true

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api_access_logs.arn
    format = jsonencode({
      requestId        = "$context.requestId"
      ip               = "$context.identity.sourceIp"
      caller           = "$context.identity.caller"
      user             = "$context.identity.user"
      requestTime      = "$context.requestTime"
      httpMethod       = "$context.httpMethod"
      resourcePath     = "$context.resourcePath"
      status           = "$context.status"
      protocol         = "$context.protocol"
      responseLength   = "$context.responseLength"
      integrationError = "$context.integrationErrorMessage"
    })
  }

  tags = { Project = var.project_name }
}

resource "aws_api_gateway_method_settings" "cashight" {
  rest_api_id = aws_api_gateway_rest_api.cashight.id
  stage_name  = aws_api_gateway_stage.prod.stage_name
  method_path = "*/*"

  settings {
    throttling_burst_limit = 50
    throttling_rate_limit  = 100
    logging_level          = "INFO"
    data_trace_enabled     = false
    metrics_enabled        = true
  }
}

# ── WAF ───────────────────────────────────────────────────────────────────────
#
# Deliberately absent. The regional ACL that guarded this stage cost $9/mo
# ($5 Web ACL + $1 per rule) — 78% of the project's entire AWS bill — to sit in
# front of an API that is already gated by Cognito plus a single-email allowlist.
# Its AWSManagedRulesCommonRuleSet also returned 403 to User-Agent-less requests,
# which broke smoke tests and uptime monitors.
#
# If reinstating: prefer API Gateway usage-plan throttling (free) for rate
# limiting, and add the ACL back with CommonRuleSet only.

# ── Custom domain and Route 53 ────────────────────────────────────────────────

resource "aws_api_gateway_domain_name" "api" {
  domain_name              = "api.cashight.nghuy.link"
  regional_certificate_arn = aws_acm_certificate_validation.api.certificate_arn

  endpoint_configuration {
    types = ["REGIONAL"]
  }

  tags = { Project = var.project_name }
}

resource "aws_api_gateway_base_path_mapping" "api" {
  api_id      = aws_api_gateway_rest_api.cashight.id
  stage_name  = aws_api_gateway_stage.prod.stage_name
  domain_name = aws_api_gateway_domain_name.api.domain_name
}

resource "aws_route53_record" "api" {
  zone_id = data.aws_route53_zone.nghuy_link.zone_id
  name    = "api.cashight.nghuy.link"
  type    = "A"

  alias {
    name                   = aws_api_gateway_domain_name.api.regional_domain_name
    zone_id                = aws_api_gateway_domain_name.api.regional_zone_id
    evaluate_target_health = false
  }
}

# ── SEC-008: Lambda invoke permissions for API Gateway ────────────────────────

resource "aws_lambda_permission" "api_session_capabilities" {
  statement_id  = "AllowAPIGatewaySessionCapabilities"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.session_capabilities_api.function_name
  qualifier     = aws_lambda_alias.session_capabilities_api_live.name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.cashight.execution_arn}/*/GET/session/capabilities"
}

resource "aws_lambda_permission" "api_cost_explorer" {
  statement_id  = "AllowAPIGatewayCostExplorer"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.cost_explorer_api.function_name
  qualifier     = aws_lambda_alias.cost_explorer_api_live.name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.cashight.execution_arn}/*/*/aws/cost-explorer/*"
}

resource "aws_lambda_permission" "api_uploads" {
  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.uploads_api.function_name
  qualifier     = aws_lambda_alias.uploads_api_live.name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.cashight.execution_arn}/*/*"
}

resource "aws_lambda_permission" "api_upload_status" {
  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.upload_status_api.function_name
  qualifier     = aws_lambda_alias.upload_status_api_live.name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.cashight.execution_arn}/*/*"
}

resource "aws_lambda_permission" "api_statements" {
  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.statements_api.function_name
  qualifier     = aws_lambda_alias.statements_api_live.name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.cashight.execution_arn}/*/*"
}

resource "aws_lambda_permission" "api_dashboard" {
  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.dashboard_api.function_name
  qualifier     = aws_lambda_alias.dashboard_api_live.name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.cashight.execution_arn}/*/*"
}

resource "aws_lambda_permission" "api_summary" {
  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.summary_api.function_name
  qualifier     = aws_lambda_alias.summary_api_live.name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.cashight.execution_arn}/*/*"
}

resource "aws_lambda_permission" "api_aws_invoices" {
  statement_id  = "AllowAPIGatewayAwsInvoices"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.aws_invoices_api.function_name
  qualifier     = aws_lambda_alias.aws_invoices_api_live.name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.cashight.execution_arn}/*/*/aws/invoices*"
}

resource "aws_lambda_permission" "api_aws_invoice_summary" {
  statement_id  = "AllowAPIGatewayAwsInvoiceSummary"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.aws_invoice_summary_api.function_name
  qualifier     = aws_lambda_alias.aws_invoice_summary_api_live.name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.cashight.execution_arn}/*/POST/aws/invoices/summary"
}

# ── Outputs ───────────────────────────────────────────────────────────────────

output "api_gateway_url" {
  value       = "https://api.cashight.nghuy.link"
  description = "Custom domain for the REST API (active after cert validation)."
}

output "api_gateway_stage_url" {
  value       = aws_api_gateway_stage.prod.invoke_url
  description = "Direct stage invoke URL (fallback before custom domain is live)."
}
