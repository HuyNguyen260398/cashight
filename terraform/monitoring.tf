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

