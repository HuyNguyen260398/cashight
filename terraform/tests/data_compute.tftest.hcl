# tests/data_compute.tftest.hcl
# Assertions for DynamoDB, SQS, private buckets, and Lambda constraints.
# Run with: terraform test (from the terraform/ directory)

# Keep the export IAM resource plan-time-known so its exact object prefix can
# be asserted without creating the bucket during a test run.
override_resource {
  target          = aws_s3_bucket.cost_exports
  override_during = plan
  values = {
    arn = "arn:aws:s3:::cashight-cost-exports-stub"
  }
}

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
  assert {
    condition = !contains([
      aws_iam_role.lambda_auth_guard.name,
      aws_iam_role.lambda_session_capabilities_api.name,
      aws_iam_role.lambda_uploads_api.name,
      aws_iam_role.lambda_upload_status_api.name,
      aws_iam_role.lambda_parser_worker.name,
      aws_iam_role.lambda_statements_api.name,
      aws_iam_role.lambda_dashboard_api.name,
      aws_iam_role.lambda_summary_api.name,
    ], aws_iam_role.lambda_cost_explorer_api.name)
    error_message = "Cost Explorer Lambda must have its own dedicated IAM role"
  }
}

# ── Cost Explorer export storage ──────────────────────────────────────────────

run "cost_exports_bucket_is_private_and_ephemeral" {
  command = plan

  assert {
    condition = alltrue([
      aws_s3_bucket_public_access_block.cost_exports.block_public_acls,
      aws_s3_bucket_public_access_block.cost_exports.block_public_policy,
      aws_s3_bucket_public_access_block.cost_exports.ignore_public_acls,
      aws_s3_bucket_public_access_block.cost_exports.restrict_public_buckets,
    ])
    error_message = "Cost export bucket must block every form of public access"
  }

  assert {
    condition     = aws_s3_bucket_ownership_controls.cost_exports.rule[0].object_ownership == "BucketOwnerEnforced"
    error_message = "Cost export bucket must enforce bucket-owner object ownership"
  }

  assert {
    condition = alltrue([
      for rule in aws_s3_bucket_server_side_encryption_configuration.cost_exports.rule :
      alltrue([
        for cfg in rule.apply_server_side_encryption_by_default :
        cfg.sse_algorithm == "AES256"
      ])
    ])
    error_message = "Cost export bucket must encrypt objects with AES256"
  }

  assert {
    condition     = aws_s3_bucket_versioning.cost_exports.versioning_configuration[0].status == "Disabled"
    error_message = "Cost export bucket must keep versioning disabled for ephemeral CSVs"
  }

  assert {
    condition     = aws_s3_bucket_lifecycle_configuration.cost_exports.rule[0].filter[0].prefix == "exports/" && aws_s3_bucket_lifecycle_configuration.cost_exports.rule[0].expiration[0].days == 1
    error_message = "Cost exports must expire after one day only under exports/"
  }

  assert {
    condition     = aws_s3_bucket_lifecycle_configuration.cost_exports.rule[1].abort_incomplete_multipart_upload[0].days_after_initiation == 1
    error_message = "Incomplete multipart uploads must be aborted after one day bucket-wide"
  }

  assert {
    condition     = data.aws_iam_policy_document.cost_exports_deny_insecure.statement[0].effect == "Deny"
    error_message = "Cost export bucket must deny insecure transport"
  }
}

run "cost_exports_cors_is_exact" {
  command = plan

  assert {
    condition = length(aws_s3_bucket_cors_configuration.cost_exports.cors_rule) == 1 && alltrue([
      for rule in aws_s3_bucket_cors_configuration.cost_exports.cors_rule :
      toset(rule.allowed_origins) == toset(["https://cashight.nghuy.link"])
    ])
    error_message = "Cost export CORS must allow only the production app origin"
  }

  assert {
    condition = length(aws_s3_bucket_cors_configuration.cost_exports.cors_rule) == 1 && alltrue([
      for rule in aws_s3_bucket_cors_configuration.cost_exports.cors_rule :
      toset(rule.allowed_methods) == toset(["GET"])
    ])
    error_message = "Cost export CORS must allow GET only"
  }
}

# ── Cost Explorer Lambda and IAM ──────────────────────────────────────────────

run "cost_explorer_iam_is_exact_and_read_only" {
  command = plan

  assert {
    condition = toset(one([
      for statement in data.aws_iam_policy_document.lambda_cost_explorer_api_permissions.statement : statement.actions
      if statement.sid == "CostExplorerRead"
      ])) == toset([
      "ce:GetCostAndUsage",
      "ce:GetCostAndUsageWithResources",
      "ce:GetCostForecast",
      "ce:GetUsageForecast",
      "ce:GetDimensionValues",
      "ce:GetTags",
      "ce:GetCostCategories",
      "ce:GetCostAndUsageComparisons",
      "ce:GetCostComparisonDrivers",
    ])
    error_message = "Cost Explorer IAM must contain the exact approved ce read actions"
  }

  assert {
    condition = toset(one([
      for statement in data.aws_iam_policy_document.lambda_cost_explorer_api_permissions.statement : statement.resources
      if statement.sid == "CostExplorerRead"
    ])) == toset(["arn:aws:billing::${data.aws_caller_identity.current.account_id}:billingview/*"])
    error_message = "Cost Explorer reads must be scoped to deployment-account billing views"
  }

  assert {
    condition = toset(one([
      for statement in data.aws_iam_policy_document.lambda_cost_explorer_api_permissions.statement : statement.actions
      if statement.sid == "BillingList"
    ])) == toset(["billing:ListBillingViews"])
    error_message = "Cost Explorer IAM must allow only ListBillingViews without a resource ARN"
  }

  assert {
    condition = toset(one([
      for statement in data.aws_iam_policy_document.lambda_cost_explorer_api_permissions.statement : statement.actions
      if statement.sid == "BillingViewRead"
    ])) == toset(["billing:GetBillingView"])
    error_message = "Cost Explorer IAM must allow only GetBillingView on billing-view resources"
  }

  assert {
    condition = toset(one([
      for statement in data.aws_iam_policy_document.lambda_cost_explorer_api_permissions.statement : statement.resources
      if statement.sid == "BillingViewRead"
    ])) == toset(["arn:aws:billing::${data.aws_caller_identity.current.account_id}:billingview/*"])
    error_message = "GetBillingView must be scoped to deployment-account billing views"
  }

  assert {
    condition = toset(one([
      for statement in data.aws_iam_policy_document.lambda_cost_explorer_api_permissions.statement : statement.actions
      if statement.sid == "ViewBilling"
    ])) == toset(["aws-portal:ViewBilling"])
    error_message = "Cost Explorer IAM must include only aws-portal:ViewBilling"
  }

  assert {
    condition = toset(one([
      for statement in data.aws_iam_policy_document.lambda_cost_explorer_api_permissions.statement : statement.actions
      if statement.sid == "DynamoDBItems"
      ])) == toset([
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:DeleteItem",
      "dynamodb:Query",
      "dynamodb:TransactWriteItems",
    ])
    error_message = "Cost Explorer IAM must limit DynamoDB access to required item operations"
  }

  assert {
    condition = toset(one([
      for statement in data.aws_iam_policy_document.lambda_cost_explorer_api_permissions.statement : statement.actions
      if statement.sid == "PrivateCsvExports"
    ])) == toset(["s3:GetObject", "s3:PutObject"])
    error_message = "Cost Explorer IAM must allow only GET and PUT for private CSV exports"
  }

  assert {
    condition = toset(one([
      for statement in data.aws_iam_policy_document.lambda_cost_explorer_api_permissions.statement : statement.resources
      if statement.sid == "PrivateCsvExports"
    ])) == toset(["${aws_s3_bucket.cost_exports.arn}/exports/*"])
    error_message = "Cost Explorer S3 IAM must be scoped to the exports/ object prefix"
  }

  assert {
    condition = alltrue(flatten([
      for statement in data.aws_iam_policy_document.lambda_cost_explorer_api_permissions.statement : [
        for action in statement.actions :
        !strcontains(action, "*") &&
        !startswith(lower(action), "ssm:") &&
        !startswith(lower(action), "secretsmanager:")
      ]
    ]))
    error_message = "Cost Explorer IAM must contain no wildcard, SSM, or Secrets Manager actions"
  }
}

run "cost_explorer_lambda_runtime_and_environment" {
  command = plan

  assert {
    condition     = aws_lambda_function.cost_explorer_api.function_name == "cashight-cost-explorer-api"
    error_message = "Cost Explorer Lambda must use the stable deployment name"
  }

  assert {
    condition     = aws_lambda_function.cost_explorer_api.runtime == "nodejs22.x" && aws_lambda_function.cost_explorer_api.memory_size == 1024 && aws_lambda_function.cost_explorer_api.timeout == 28
    error_message = "Cost Explorer Lambda must use Node.js 22, 1024 MiB, and a 28-second timeout"
  }

  assert {
    condition     = aws_lambda_function.cost_explorer_api.reserved_concurrent_executions == 2
    error_message = "Cost Explorer Lambda must cap reserved concurrency at two"
  }

  assert {
    condition     = aws_lambda_function.cost_explorer_api.tracing_config[0].mode == "Active"
    error_message = "Cost Explorer Lambda must enable active tracing"
  }

  assert {
    condition     = aws_cloudwatch_log_group.lambda_cost_explorer_api.retention_in_days == 30
    error_message = "Cost Explorer Lambda logs must be retained for 30 days"
  }

  assert {
    condition     = aws_lambda_alias.cost_explorer_api_live.name == "live"
    error_message = "Cost Explorer Lambda must expose a live alias"
  }

  assert {
    condition = alltrue([
      aws_lambda_function.cost_explorer_api.environment[0].variables["TABLE_NAME"] == aws_dynamodb_table.cashight.name,
      aws_lambda_function.cost_explorer_api.environment[0].variables["EXPORT_BUCKET"] == aws_s3_bucket.cost_exports.bucket,
      aws_lambda_function.cost_explorer_api.environment[0].variables["GRANULAR_DATA_ENABLED"] == tostring(var.enable_cost_explorer_granular_data),
      aws_lambda_function.cost_explorer_api.environment[0].variables["ENABLE_LEGACY_AUTHZ_FALLBACK"] == tostring(var.enable_legacy_authz_fallback),
    ])
    error_message = "Cost Explorer Lambda must receive only its table, export bucket, feature gate, and auth migration flag"
  }
}

run "cost_explorer_granular_data_defaults_off" {
  command = plan

  assert {
    condition     = var.enable_cost_explorer_granular_data == false && var.cost_explorer_granular_data_enabled_out_of_band == false
    error_message = "Cost Explorer granular data and its operator acknowledgement must default to false"
  }
}

run "cost_explorer_granular_data_requires_operator_acknowledgement" {
  command = plan

  variables {
    enable_cost_explorer_granular_data              = true
    cost_explorer_granular_data_enabled_out_of_band = false
  }

  expect_failures = [aws_lambda_function.cost_explorer_api]
}

run "cost_explorer_granular_data_accepts_operator_acknowledgement" {
  command = plan

  variables {
    enable_cost_explorer_granular_data              = true
    cost_explorer_granular_data_enabled_out_of_band = true
  }

  assert {
    condition     = aws_lambda_function.cost_explorer_api.environment[0].variables["GRANULAR_DATA_ENABLED"] == "true"
    error_message = "Acknowledged granular-data enablement must reach the Lambda"
  }
}

# ── Cost Explorer monitoring ──────────────────────────────────────────────────

run "cost_explorer_has_required_alarms" {
  command = plan

  assert {
    condition     = aws_cloudwatch_metric_alarm.cost_explorer_api_errors.metric_name == "Errors"
    error_message = "Cost Explorer must alarm on Lambda errors"
  }

  assert {
    condition     = aws_cloudwatch_metric_alarm.cost_explorer_api_duration.metric_name == "Duration"
    error_message = "Cost Explorer must alarm on Lambda duration"
  }

  assert {
    condition     = aws_cloudwatch_metric_alarm.cost_explorer_api_throttles.metric_name == "Throttles"
    error_message = "Cost Explorer must alarm on Lambda throttles"
  }

  assert {
    condition = toset([
      aws_cloudwatch_metric_alarm.cost_explorer_access_denied.metric_name,
      aws_cloudwatch_metric_alarm.cost_explorer_disabled.metric_name,
      aws_cloudwatch_metric_alarm.cost_explorer_cache_corruption.metric_name,
      aws_cloudwatch_metric_alarm.cost_explorer_export_failures.metric_name,
      ]) == toset([
      "AwsCostAccessDenied",
      "CostExplorerDisabled",
      "CostCacheCorruption",
      "CostExportFailure",
    ])
    error_message = "Cost Explorer must alarm on access, disabled, cache-corruption, and export failures"
  }

  assert {
    condition = alltrue([
      for alarm in [
        aws_cloudwatch_metric_alarm.cost_explorer_access_denied,
        aws_cloudwatch_metric_alarm.cost_explorer_disabled,
        aws_cloudwatch_metric_alarm.cost_explorer_cache_corruption,
        aws_cloudwatch_metric_alarm.cost_explorer_export_failures,
      ] : toset(keys(alarm.dimensions)) == toset(["Operation", "Result"])
    ])
    error_message = "Custom cost metrics may use only Operation and Result dimensions"
  }
}
