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
