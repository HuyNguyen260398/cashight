# Run with: terraform test (from terraform/v2/). Mock providers: no AWS
# credentials or v1 state needed.

mock_provider "aws" {
  mock_data "aws_iam_policy_document" {
    defaults = { json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}" }
  }
}

mock_provider "aws" {
  alias = "global"
  mock_data "aws_iam_policy_document" {
    defaults = { json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}" }
  }
}

override_data {
  target = data.aws_caller_identity.current
  values = { account_id = "111122223333" }
}

override_data {
  target = data.terraform_remote_state.v1
  values = {
    outputs = {
      cognito_user_pool_id    = "ap-southeast-1_stub"
      cognito_smoke_client_id = "smokeclient"
    }
  }
}

override_resource {
  target          = aws_sqs_queue.parse_dlq
  override_during = plan
  values          = { arn = "arn:aws:sqs:ap-southeast-1:111122223333:cashight-v2-parse-dlq" }
}

run "table_mirrors_v1" {
  command = plan

  assert {
    condition = (
      aws_dynamodb_table.cashight.name == "cashight-v2" &&
      aws_dynamodb_table.cashight.billing_mode == "PAY_PER_REQUEST" &&
      aws_dynamodb_table.cashight.hash_key == "PK" && aws_dynamodb_table.cashight.range_key == "SK" &&
      aws_dynamodb_table.cashight.deletion_protection_enabled == true &&
      one(aws_dynamodb_table.cashight.ttl).attribute_name == "expiresAtEpoch" &&
      one(aws_dynamodb_table.cashight.point_in_time_recovery).enabled == true
    )
    error_message = "v2 table must mirror v1's settings under the name cashight-v2"
  }
}

run "bucket_names_are_v2" {
  command = plan

  assert {
    condition = (
      aws_s3_bucket.statements.bucket == "cashight-v2-statements-111122223333" &&
      aws_s3_bucket.uploads.bucket == "cashight-v2-uploads-111122223333" &&
      aws_s3_bucket.cost_exports.bucket == "cashight-v2-cost-exports-111122223333"
    )
    error_message = "bucket names"
  }
}

run "uploads_notify_both_queues" {
  command = plan

  assert {
    condition = (
      length(aws_s3_bucket_notification.uploads.queue) == 2 &&
      contains([for q in aws_s3_bucket_notification.uploads.queue : "${q.filter_prefix}|${q.filter_suffix}"], "uploads/statements/|.pdf") &&
      contains([for q in aws_s3_bucket_notification.uploads.queue : "${q.filter_prefix}|${q.filter_suffix}"], "uploads/aws-invoices/|.pdf")
    )
    error_message = "notification filters must equal v1's"
  }
}

run "queues_mirror_v1" {
  command = plan

  assert {
    condition = (
      aws_sqs_queue.parse.name == "cashight-v2-parse" && aws_sqs_queue.parse.visibility_timeout_seconds == 360 &&
      aws_sqs_queue.invoice_parse.name == "cashight-v2-invoice-parse" && aws_sqs_queue.invoice_parse.visibility_timeout_seconds == 360 &&
      aws_sqs_queue.parse_dlq.message_retention_seconds == 1209600 &&
      jsondecode(aws_sqs_queue.parse.redrive_policy).maxReceiveCount == 3
    )
    error_message = "queue settings"
  }
}

run "cors_allows_only_the_v2_origin" {
  command = plan

  assert {
    condition = (
      one(aws_s3_bucket_cors_configuration.uploads.cors_rule).allowed_origins == toset(["https://cashight-v2.nghuy.link"]) &&
      one(aws_s3_bucket_cors_configuration.uploads.cors_rule).allowed_methods == toset(["PUT"]) &&
      one(aws_s3_bucket_cors_configuration.cost_exports.cors_rule).allowed_origins == toset(["https://cashight-v2.nghuy.link"])
    )
    error_message = "v2 buckets allow only the v2 origin"
  }
}
