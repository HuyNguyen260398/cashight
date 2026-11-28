# terraform/security.tf — security alerting and IAM Access Analyzer
#
# All $0/month: 2 alarms sit inside CloudWatch's free 10 standard alarms per
# account (4 exist today, in us-east-1); SNS email is free under 1,000
# notifications a month; external-access analysis is free (the paid "unused
# access" analyzer type is not used).

# ── Alert topic ──────────────────────────────────────────────────────────────

resource "aws_sns_topic" "security_alerts" {
  name = "${var.project_name}-security-alerts"
  tags = { Project = var.project_name }
}

# Sent to the account owner. Skipped when allowed_email is unset so validate and
# plans without the variable still work. The owner must click the confirmation
# link AWS emails before any alert is delivered.
resource "aws_sns_topic_subscription" "security_alerts_email" {
  count     = var.allowed_email == "" ? 0 : 1
  topic_arn = aws_sns_topic.security_alerts.arn
  protocol  = "email"
  endpoint  = var.allowed_email
}

# ── Alarms ───────────────────────────────────────────────────────────────────

# auth-guard throws AccessDenied for every rejected sign-up or token issue, so
# Lambda Errors counts denied sign-ins (plus genuine crashes, also worth a look).
resource "aws_cloudwatch_metric_alarm" "auth_guard_denials" {
  alarm_name          = "${var.project_name}-auth-guard-denials"
  alarm_description   = "3+ denied sign-ins or auth-guard failures in 5 minutes."
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions          = { FunctionName = aws_lambda_function.auth_guard.function_name }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 3
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.security_alerts.arn]
  tags                = { Project = var.project_name }
}

# A burst of 401/403/429 suggests probing or a client stuck in a retry loop.
resource "aws_cloudwatch_metric_alarm" "api_4xx_burst" {
  alarm_name        = "${var.project_name}-api-4xx-burst"
  alarm_description = "50+ API 4XX responses in 5 minutes."
  namespace         = "AWS/ApiGateway"
  metric_name       = "4XXError"
  dimensions = {
    ApiName = aws_api_gateway_rest_api.cashight.name
    Stage   = aws_api_gateway_stage.prod.stage_name
  }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 50
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.security_alerts.arn]
  tags                = { Project = var.project_name }
}

# ── IAM Access Analyzer ──────────────────────────────────────────────────────
# Account-level and regional (ap-southeast-1). The account is shared with other
# projects; if one of them later creates its own analyzer, only one is needed.

resource "aws_accessanalyzer_analyzer" "account" {
  analyzer_name = "cashight-external-access"
  type          = "ACCOUNT"
  tags          = { Project = var.project_name }
}
