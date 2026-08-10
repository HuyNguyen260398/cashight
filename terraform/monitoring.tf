locals {
  security_alarm_actions = var.enable_security_alarms && var.alarm_email != "" ? [
    aws_sns_topic.security_alarms[0].arn,
  ] : []
}

resource "aws_sns_topic" "security_alarms" {
  count = var.enable_security_alarms && var.alarm_email != "" ? 1 : 0

  name = "${var.project_name}-security-alarms"
}

resource "aws_sns_topic_subscription" "security_alarm_email" {
  count = var.enable_security_alarms && var.alarm_email != "" ? 1 : 0

  topic_arn = aws_sns_topic.security_alarms[0].arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

resource "aws_cloudwatch_metric_alarm" "session_capabilities_api_errors" {
  alarm_name          = "cashight-session-capabilities-api-errors"
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_description   = "session-capabilities-api Lambda errors — check its CloudWatch logs"
  alarm_actions       = local.security_alarm_actions

  dimensions = {
    FunctionName = aws_lambda_function.session_capabilities_api.function_name
  }
}

# ── Cost Explorer API ─────────────────────────────────────────────────────────

resource "aws_cloudwatch_metric_alarm" "cost_explorer_api_errors" {
  alarm_name          = "cashight-cost-explorer-api-errors"
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_description   = "Cost Explorer Lambda errors"
  alarm_actions       = local.security_alarm_actions

  dimensions = {
    FunctionName = aws_lambda_function.cost_explorer_api.function_name
  }
}

resource "aws_cloudwatch_metric_alarm" "cost_explorer_api_duration" {
  alarm_name          = "cashight-cost-explorer-api-duration"
  namespace           = "AWS/Lambda"
  metric_name         = "Duration"
  extended_statistic  = "p95"
  period              = 300
  evaluation_periods  = 2
  threshold           = 25000
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_description   = "Cost Explorer p95 duration is approaching its 28-second timeout"
  alarm_actions       = local.security_alarm_actions

  dimensions = {
    FunctionName = aws_lambda_function.cost_explorer_api.function_name
  }
}

resource "aws_cloudwatch_metric_alarm" "cost_explorer_api_throttles" {
  alarm_name          = "cashight-cost-explorer-api-throttles"
  namespace           = "AWS/Lambda"
  metric_name         = "Throttles"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_description   = "Cost Explorer Lambda throttles"
  alarm_actions       = local.security_alarm_actions

  dimensions = {
    FunctionName = aws_lambda_function.cost_explorer_api.function_name
  }
}

resource "aws_cloudwatch_metric_alarm" "cost_explorer_access_denied" {
  alarm_name          = "cashight-cost-explorer-access-denied"
  namespace           = "Cashight"
  metric_name         = "AwsCostAccessDenied"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_description   = "Deployment role was denied access to AWS cost data"
  alarm_actions       = local.security_alarm_actions

  dimensions = {
    Operation = "cost-explorer"
    Result    = "access-denied"
  }
}

resource "aws_cloudwatch_metric_alarm" "cost_explorer_disabled" {
  alarm_name          = "cashight-cost-explorer-disabled"
  namespace           = "Cashight"
  metric_name         = "CostExplorerDisabled"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_description   = "AWS Cost Explorer is disabled or unavailable"
  alarm_actions       = local.security_alarm_actions

  dimensions = {
    Operation = "cost-explorer"
    Result    = "disabled"
  }
}

resource "aws_cloudwatch_metric_alarm" "cost_explorer_cache_corruption" {
  alarm_name          = "cashight-cost-explorer-cache-corruption"
  namespace           = "Cashight"
  metric_name         = "CostCacheCorruption"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_description   = "A Cost Explorer cache manifest or chunk failed validation"
  alarm_actions       = local.security_alarm_actions

  dimensions = {
    Operation = "cache"
    Result    = "corrupt"
  }
}

resource "aws_cloudwatch_metric_alarm" "cost_explorer_export_failures" {
  alarm_name          = "cashight-cost-explorer-export-failures"
  namespace           = "Cashight"
  metric_name         = "CostExportFailure"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_description   = "A private Cost Explorer CSV export failed"
  alarm_actions       = local.security_alarm_actions

  dimensions = {
    Operation = "export"
    Result    = "failure"
  }
}
