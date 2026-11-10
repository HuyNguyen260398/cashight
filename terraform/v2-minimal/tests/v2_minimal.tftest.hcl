# Run with: terraform test (from terraform/v2-minimal/). Mock providers: no AWS
# credentials, v2 state or cluster needed.

# Computed strings default to random text, which the AWS provider rejects
# where it expects a policy document or an ARN.
mock_provider "aws" {
  mock_data "aws_iam_policy_document" {
    defaults = { json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}" }
  }
  mock_data "aws_caller_identity" {
    defaults = {
      account_id = "111122223333"
      arn        = "arn:aws:iam::111122223333:user/test"
    }
  }
  mock_data "aws_partition" {
    defaults = { partition = "aws", dns_suffix = "amazonaws.com" }
  }
  mock_data "aws_region" {
    defaults = { region = "ap-southeast-1", name = "ap-southeast-1" }
  }
  mock_data "aws_iam_session_context" {
    defaults = { issuer_arn = "arn:aws:iam::111122223333:user/test" }
  }
  mock_resource "aws_iam_role" {
    defaults = { arn = "arn:aws:iam::111122223333:role/mock" }
  }
  mock_resource "aws_iam_policy" {
    defaults = { arn = "arn:aws:iam::111122223333:policy/mock" }
  }
  mock_resource "aws_cloudwatch_log_group" {
    defaults = { arn = "arn:aws:logs:ap-southeast-1:111122223333:log-group:mock" }
  }
  mock_resource "aws_lambda_function" {
    defaults = {
      arn           = "arn:aws:lambda:ap-southeast-1:111122223333:function:mock"
      qualified_arn = "arn:aws:lambda:ap-southeast-1:111122223333:function:mock:1"
      version       = "1"
    }
  }
  mock_resource "aws_lambda_alias" {
    defaults = { arn = "arn:aws:lambda:ap-southeast-1:111122223333:function:mock:live" }
  }
}
mock_provider "kubernetes" {}
mock_provider "helm" {}
mock_provider "tls" {}
mock_provider "time" {}
mock_provider "cloudinit" {}
mock_provider "null" {}
mock_provider "archive" {}

override_data {
  target = data.terraform_remote_state.v2
  values = {
    outputs = {
      table_name              = "cashight-v2"
      table_arn               = "arn:aws:dynamodb:ap-southeast-1:111122223333:table/cashight-v2"
      statements_bucket_name  = "cashight-v2-statements-111122223333"
      statements_bucket_arn   = "arn:aws:s3:::cashight-v2-statements-111122223333"
      uploads_bucket_name     = "cashight-v2-uploads-111122223333"
      uploads_bucket_arn      = "arn:aws:s3:::cashight-v2-uploads-111122223333"
      cost_exports_bucket_arn = "arn:aws:s3:::cashight-v2-cost-exports-111122223333"
      parse_queue_arn         = "arn:aws:sqs:ap-southeast-1:111122223333:cashight-v2-parse"
      invoice_parse_queue_arn = "arn:aws:sqs:ap-southeast-1:111122223333:cashight-v2-invoice-parse"
      api_certificate_arn     = "arn:aws:acm:ap-southeast-1:111122223333:certificate/api-stub"
      github_ci_role_arn      = "arn:aws:iam::111122223333:role/cashight-v2-github-ci"
    }
  }
}

override_data {
  target = data.aws_eks_clusters.all
  values = { names = [] }
}

override_data {
  target = data.aws_lbs.cashight
  values = { arns = [] }
}

override_data {
  target = module.cluster.data.aws_availability_zones.available
  values = {
    names = ["ap-southeast-1a", "ap-southeast-1b", "ap-southeast-1c"]
  }
}

variables {
  admin_principal_arns = ["arn:aws:iam::111122223333:role/admin"]
}

run "no_ec2_and_one_nat" {
  command = plan

  assert {
    condition     = length(module.cluster.nat_gateway_ids) == 1
    error_message = "exactly one NAT gateway"
  }

  assert {
    condition     = module.cluster.gateway_endpoint_types == ["Gateway", "Gateway"]
    error_message = "S3 and DynamoDB endpoints must be Gateway endpoints"
  }

  assert {
    condition     = module.cluster.managed_node_group_count == 0
    error_message = "no managed node groups"
  }
}

run "standard_support" {
  command = plan

  assert {
    condition     = module.cluster.upgrade_support_type == "STANDARD"
    error_message = "the cluster must never drift onto extended support"
  }
}

run "extended_support_version_rejected" {
  command = plan

  variables {
    kubernetes_version = "1.29"
  }

  expect_failures = [var.kubernetes_version]
}

run "refuses_while_full_cluster_exists" {
  command = plan

  override_data {
    target = data.aws_eks_clusters.all
    values = { names = ["cashight-v2"] }
  }

  expect_failures = [terraform_data.exclusive_with_full_platform]
}

run "api_role_has_no_gemini" {
  command = plan

  assert {
    condition     = !contains([for s in local.api_statements : s.sid], "GetGeminiKey")
    error_message = "the API role must not read the Gemini key"
  }

  assert {
    condition = toset([for s in local.api_statements : s.sid]) == toset([
      "S3PutUploads", "S3ReadDeleteStatements", "DynamoDBAccess",
      "CostExplorerRead", "BillingRead", "BillingViewRead", "DynamoDBItems",
      "PrivateCsvExports", "S3WriteInvoiceUploads", "S3ReadDeleteInvoices",
    ])
    error_message = "the API role is the union of the api and aws-api grants minus GetGeminiKey"
  }

  assert {
    condition     = local.api_service_account_subject == "system:serviceaccount:cashight:cashight-api"
    error_message = "IRSA trust subject"
  }

  assert {
    condition     = aws_iam_role.api.name == "cashight-v2-min-api"
    error_message = "role name"
  }
}

run "dns_waits_for_alb" {
  command = plan

  assert {
    condition     = length(aws_route53_record.api) == 0
    error_message = "no record before the ALB exists"
  }
}

run "dns_points_at_alb" {
  command = plan

  override_data {
    target = data.aws_lbs.cashight
    values = { arns = ["arn:aws:elasticloadbalancing:ap-southeast-1:111122223333:loadbalancer/app/k8s-cashight-abc/123"] }
  }

  override_data {
    target = data.aws_lb.cashight
    values = { dns_name = "k8s-cashight-abc.ap-southeast-1.elb.amazonaws.com", zone_id = "Z1LMS91P8CMLE5" }
  }

  override_data {
    target = data.aws_route53_zone.nghuy_link
    values = { zone_id = "Z000STUB" }
  }

  assert {
    condition     = toset(keys(aws_route53_record.api)) == toset(["A", "AAAA"])
    error_message = "A and AAAA records"
  }

  assert {
    condition     = alltrue([for r in aws_route53_record.api : r.name == "api.cashight-v2.nghuy.link"])
    error_message = "record name"
  }
}

run "fargate_logging" {
  command = plan

  assert {
    condition     = strcontains(kubernetes_config_map_v1.aws_logging.data["output.conf"], "/cashight/v2-min/app")
    error_message = "logs ship to the app log group"
  }

  assert {
    condition     = strcontains(kubernetes_config_map_v1.aws_logging.data["filters.conf"], "^cashight$")
    error_message = "only the cashight namespace ships"
  }

  assert {
    condition     = aws_cloudwatch_log_group.app.retention_in_days == 7
    error_message = "7-day retention"
  }

  assert {
    condition     = aws_cloudwatch_log_group.app.name == "/cashight/v2-min/app"
    error_message = "log group name"
  }
}

run "workers" {
  command = plan

  # Alias ARNs are otherwise unknown until apply.
  override_resource {
    target          = aws_lambda_alias.parser_worker_live
    override_during = plan
    values          = { arn = "arn:aws:lambda:ap-southeast-1:111122223333:function:cashight-v2-parser-worker:live" }
  }

  override_resource {
    target          = aws_lambda_alias.invoice_parser_worker_live
    override_during = plan
    values          = { arn = "arn:aws:lambda:ap-southeast-1:111122223333:function:cashight-v2-invoice-parser-worker:live" }
  }

  assert {
    condition = alltrue([
      for f in [aws_lambda_function.parser_worker, aws_lambda_function.invoice_parser_worker] :
      f.architectures == tolist(["arm64"]) && f.runtime == "nodejs22.x" && f.ephemeral_storage[0].size == 1024
    ])
    error_message = "arm64, nodejs22.x, 1024 MB ephemeral storage"
  }

  assert {
    condition = (
      aws_lambda_function.parser_worker.function_name == "cashight-v2-parser-worker" &&
      aws_lambda_function.invoice_parser_worker.function_name == "cashight-v2-invoice-parser-worker"
    )
    error_message = "function names"
  }

  assert {
    condition = (
      aws_lambda_function.parser_worker.memory_size == 1536 &&
      aws_lambda_function.parser_worker.timeout == 120 &&
      aws_lambda_function.parser_worker.reserved_concurrent_executions == 2
    )
    error_message = "parser sizing"
  }

  assert {
    condition = (
      aws_lambda_function.invoice_parser_worker.memory_size == 2048 &&
      aws_lambda_function.invoice_parser_worker.timeout == 300 &&
      aws_lambda_function.invoice_parser_worker.reserved_concurrent_executions == 1
    )
    error_message = "invoice parser sizing"
  }

  assert {
    condition = alltrue([
      for m in [aws_lambda_event_source_mapping.parser_worker, aws_lambda_event_source_mapping.invoice_parser_worker] :
      m.batch_size == 1 && m.function_response_types == toset(["ReportBatchItemFailures"])
    ])
    error_message = "batch size 1 with partial batch failures"
  }

  assert {
    condition = (
      aws_lambda_event_source_mapping.parser_worker.function_name == aws_lambda_alias.parser_worker_live.arn &&
      aws_lambda_event_source_mapping.invoice_parser_worker.function_name == aws_lambda_alias.invoice_parser_worker_live.arn &&
      aws_lambda_alias.parser_worker_live.name == "live" &&
      aws_lambda_alias.invoice_parser_worker_live.name == "live"
    )
    error_message = "event source mappings target the live aliases"
  }

  assert {
    condition = (
      aws_lambda_event_source_mapping.parser_worker.event_source_arn == "arn:aws:sqs:ap-southeast-1:111122223333:cashight-v2-parse" &&
      aws_lambda_event_source_mapping.invoice_parser_worker.event_source_arn == "arn:aws:sqs:ap-southeast-1:111122223333:cashight-v2-invoice-parse"
    )
    error_message = "queues"
  }

  assert {
    condition     = aws_lambda_function.parser_worker.environment[0].variables["PDF_PASSWORD_PARAM"] == "/cashight/prod/pdf-password"
    error_message = "the parser reads the PDF password"
  }

  assert {
    condition     = !contains(keys(aws_lambda_function.invoice_parser_worker.environment[0].variables), "PDF_PASSWORD_PARAM")
    error_message = "only the parser reads the PDF password"
  }

  assert {
    condition = alltrue([
      for f in [aws_lambda_function.parser_worker, aws_lambda_function.invoice_parser_worker] :
      !contains(keys(f.environment[0].variables), "ENABLE_LEGACY_WORKSPACE_FALLBACK") &&
      !contains(keys(f.environment[0].variables), "GEMINI_PARAM") &&
      f.environment[0].variables["TABLE_NAME"] == "cashight-v2" &&
      f.environment[0].variables["STORAGE_REGION"] == "ap-southeast-1"
    ])
    error_message = "no legacy fallback or Gemini; v2 table"
  }

  assert {
    condition = (
      aws_cloudwatch_log_group.parser_worker.retention_in_days == 7 &&
      aws_cloudwatch_log_group.invoice_parser_worker.retention_in_days == 7 &&
      aws_cloudwatch_log_group.parser_worker.name == "/aws/lambda/cashight-v2-parser-worker" &&
      aws_cloudwatch_log_group.invoice_parser_worker.name == "/aws/lambda/cashight-v2-invoice-parser-worker"
    )
    error_message = "7-day log groups"
  }

  assert {
    condition = (
      aws_iam_role.parser_worker.name == "cashight-v2-min-parser-worker" &&
      aws_iam_role.invoice_parser_worker.name == "cashight-v2-min-invoice-parser-worker"
    )
    error_message = "role names"
  }

  # The sids of terraform/platform/workloads.tf's parser-worker and
  # invoice-parser-worker, plus Logs.
  assert {
    condition = toset([for s in local.worker_statements.parser_worker : s.sid]) == toset([
      "S3ReadDeleteUploads", "S3ReadWriteStatements", "DynamoDBAccess", "GetPdfPassword", "SQSConsume", "Logs",
    ])
    error_message = "parser worker grants"
  }

  assert {
    condition = toset([for s in local.worker_statements.invoice_parser_worker : s.sid]) == toset([
      "S3ReadDeleteInvoiceUploads", "S3ReadWriteInvoices", "S3ListStatementsBucket", "DynamoDBInvoiceAccess", "SQSConsumeInvoiceQueue", "Logs",
    ])
    error_message = "invoice parser worker grants"
  }
}

# Review fix: with one replica, the old pod must not go before the ALB has a
# healthy target on the new one. The controller's webhook injects the ALB
# readiness gate into pods of a namespace with this label.
run "alb_readiness_gate" {
  command = plan

  assert {
    condition     = kubernetes_namespace_v1.cashight.metadata[0].labels["elbv2.k8s.aws/pod-readiness-gate-inject"] == "enabled"
    error_message = "the cashight namespace must enable the ALB pod readiness gate"
  }
}

# Review fix: the controller-created ALB must carry the Environment tag, or the
# v2-minimal tag budget misses it.
run "alb_carries_cost_tags" {
  command = plan

  assert {
    condition     = lookup(local.lbc_values, "defaultTags", {}) == { Environment = "v2-minimal", ManagedBy = "Terraform", Project = "cashight" }
    error_message = "the controller tags what it creates with the root's tags"
  }
}
