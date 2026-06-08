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

resource "aws_cloudwatch_metric_alarm" "amplify_5xx_errors" {
  alarm_name          = "${var.project_name}-amplify-5xx-errors"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "5xxErrors"
  namespace           = "AWS/AmplifyHosting"
  period              = 300
  statistic           = "Sum"
  threshold           = 5
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.security_alarm_actions

  dimensions = {
    App = aws_amplify_app.cashight.id
  }
}

resource "aws_cloudwatch_metric_alarm" "amplify_4xx_errors" {
  alarm_name          = "${var.project_name}-amplify-4xx-errors"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "4xxErrors"
  namespace           = "AWS/AmplifyHosting"
  period              = 300
  statistic           = "Sum"
  threshold           = 50
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.security_alarm_actions

  dimensions = {
    App = aws_amplify_app.cashight.id
  }
}

resource "aws_cloudwatch_metric_alarm" "amplify_latency" {
  alarm_name          = "${var.project_name}-amplify-latency"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "Latency"
  namespace           = "AWS/AmplifyHosting"
  period              = 300
  statistic           = "Average"
  threshold           = 3
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.security_alarm_actions

  dimensions = {
    App = aws_amplify_app.cashight.id
  }
}
