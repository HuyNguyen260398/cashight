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
