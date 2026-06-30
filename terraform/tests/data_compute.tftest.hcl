# tests/data_compute.tftest.hcl
# Assertions for Task 11: DynamoDB, SQS, uploads bucket, and Lambda constraints.
# Run with: terraform test (from the terraform/ directory)

run "dynamodb_billing_mode" {
  command = plan

  assert {
    condition     = aws_dynamodb_table.cashight.billing_mode == "PAY_PER_REQUEST"
    error_message = "DynamoDB table must use PAY_PER_REQUEST billing — provisioned capacity not acceptable for this workload"
  }
}

run "dynamodb_pitr_enabled" {
  command = plan

  assert {
    condition = alltrue([
      for pitr in aws_dynamodb_table.cashight.point_in_time_recovery : pitr.enabled
    ])
    error_message = "DynamoDB table must have point-in-time recovery enabled for durability"
  }
}

run "dynamodb_deletion_protection" {
  command = plan

  assert {
    condition     = aws_dynamodb_table.cashight.deletion_protection_enabled == true
    error_message = "DynamoDB table must have deletion protection enabled to prevent accidental drops"
  }
}

run "sqs_visibility_timeout" {
  command = plan

  assert {
    condition     = aws_sqs_queue.parse.visibility_timeout_seconds == 360
    error_message = "Parse SQS queue visibility timeout must be 360 seconds (3x parser-worker timeout)"
  }
}

run "sqs_sse_enabled" {
  command = plan

  # The redrive_policy JSON contains an unknown ARN at plan time so its
  # jsondecode() can't be evaluated. Test SSE and DLQ name instead.
  assert {
    condition     = aws_sqs_queue.parse.sqs_managed_sse_enabled == true
    error_message = "Parse SQS queue must have SQS-managed SSE enabled"
  }

  assert {
    condition     = aws_sqs_queue.parse_dlq.sqs_managed_sse_enabled == true
    error_message = "Parse DLQ must have SQS-managed SSE enabled"
  }
}

run "dlq_retention_period" {
  command = plan

  assert {
    condition     = aws_sqs_queue.parse_dlq.message_retention_seconds == 1209600
    error_message = "DLQ must retain messages for 14 days (1 209 600 seconds) for investigation"
  }
}

run "uploads_bucket_public_access_blocked" {
  command = plan

  assert {
    condition     = aws_s3_bucket_public_access_block.uploads.block_public_acls == true
    error_message = "Uploads bucket must block public ACLs"
  }

  assert {
    condition     = aws_s3_bucket_public_access_block.uploads.block_public_policy == true
    error_message = "Uploads bucket must block public bucket policies"
  }

  assert {
    condition     = aws_s3_bucket_public_access_block.uploads.restrict_public_buckets == true
    error_message = "Uploads bucket must restrict public bucket access"
  }
}

run "parser_worker_concurrency_and_timeout" {
  command = plan

  assert {
    condition     = aws_lambda_function.parser_worker.reserved_concurrent_executions == 2
    error_message = "parser-worker must cap at 2 reserved concurrent executions (CON-003)"
  }

  assert {
    condition     = aws_lambda_function.parser_worker.timeout == 120
    error_message = "parser-worker timeout must be 120 seconds"
  }

  assert {
    condition     = aws_lambda_function.parser_worker.memory_size == 1536
    error_message = "parser-worker must have 1536 MB memory for PDF processing"
  }
}

run "summary_api_concurrency" {
  command = plan

  assert {
    condition     = aws_lambda_function.summary_api.reserved_concurrent_executions == 2
    error_message = "summary-api must cap at 2 reserved concurrent executions (CON-004)"
  }

  assert {
    condition     = aws_lambda_function.summary_api.timeout == 120
    error_message = "summary-api timeout must be 120 seconds for streaming Gemini responses"
  }
}

run "dynamodb_ttl_attribute" {
  command = plan

  assert {
    condition     = aws_dynamodb_table.cashight.ttl[0].attribute_name == "expiresAtEpoch"
    error_message = "DynamoDB TTL attribute must be 'expiresAtEpoch'"
  }
}

run "dynamodb_encryption_enabled" {
  command = plan

  assert {
    condition     = aws_dynamodb_table.cashight.server_side_encryption[0].enabled == true
    error_message = "DynamoDB must have server-side encryption enabled"
  }
}

run "parser_worker_ephemeral_storage" {
  command = plan

  assert {
    condition     = aws_lambda_function.parser_worker.ephemeral_storage[0].size == 1024
    error_message = "parser-worker ephemeral storage must be 1024 MiB"
  }
}

run "summary_api_memory" {
  command = plan

  assert {
    condition     = aws_lambda_function.summary_api.memory_size == 1024
    error_message = "summary-api memory must be 1024 MiB"
  }
}

run "uploads_bucket_tls_only_policy_exists" {
  command = plan
  # aws_s3_bucket_policy attributes (.bucket, .policy) are computed and
  # unknown at plan time for new resources. Assert via the data source's
  # static condition block, which has no dependency on the bucket ARN.
  assert {
    condition     = data.aws_iam_policy_document.uploads_deny_insecure.statement[0].effect == "Deny"
    error_message = "Uploads bucket must have a TLS-only bucket policy attached"
  }
}

run "lambda_roles_are_distinct" {
  command = plan
  # IAM role ARNs are computed (unknown at plan time for new resources).
  # Compare role names instead — they are input attributes, always known
  # during plan, and each function has a unique role name in the config.
  assert {
    condition     = aws_iam_role.lambda_auth_guard.name != aws_iam_role.lambda_parser_worker.name
    error_message = "Each Lambda function must have its own dedicated IAM role"
  }
  assert {
    condition     = aws_iam_role.lambda_uploads_api.name != aws_iam_role.lambda_summary_api.name
    error_message = "Each Lambda function must have its own dedicated IAM role"
  }
  assert {
    condition     = aws_iam_role.lambda_statements_api.name != aws_iam_role.lambda_dashboard_api.name
    error_message = "Each Lambda function must have its own dedicated IAM role"
  }
  assert {
    condition     = aws_iam_role.lambda_upload_status_api.name != aws_iam_role.lambda_parser_worker.name
    error_message = "Each Lambda function must have its own dedicated IAM role"
  }
}
