# terraform/observability.tf — CloudWatch alarms for serverless data and compute resources

resource "aws_cloudwatch_metric_alarm" "dlq_messages" {
  alarm_name          = "cashight-parse-dlq-messages"
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_description   = "Messages in parse DLQ — investigate parser failures"
  alarm_actions       = local.security_alarm_actions

  dimensions = {
    QueueName = aws_sqs_queue.parse_dlq.name
  }
}

resource "aws_cloudwatch_metric_alarm" "parser_worker_errors" {
  alarm_name          = "cashight-parser-worker-errors"
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_description   = "parser-worker Lambda errors — check /aws/lambda/cashight-parser-worker logs"
  alarm_actions       = local.security_alarm_actions

  dimensions = {
    FunctionName = aws_lambda_function.parser_worker.function_name
  }
}

resource "aws_cloudwatch_metric_alarm" "summary_api_errors" {
  alarm_name          = "cashight-summary-api-errors"
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 2
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_description   = "summary-api Lambda errors — possible Gemini API or S3 issue"
  alarm_actions       = local.security_alarm_actions

  dimensions = {
    FunctionName = aws_lambda_function.summary_api.function_name
  }
}
