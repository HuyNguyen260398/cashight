data "aws_caller_identity" "current" {}

# The persistent v2 stores, edge, ECR and CI role.
data "terraform_remote_state" "v2" {
  backend = "s3"

  config = {
    bucket     = "cashight-tfstate"
    key        = "cashight/v2/terraform.tfstate"
    region     = "ap-southeast-1"
    encrypt    = true
    kms_key_id = "alias/cashight-tfstate"
  }
}

locals {
  cluster_name   = "cashight-v2-min"
  api_hostname   = "api.cashight-v2.nghuy.link"
  log_group_name = "/cashight/v2-min/app"

  v2         = data.terraform_remote_state.v2.outputs
  account_id = data.aws_caller_identity.current.account_id

  tags = {
    Environment = "v2-minimal"
    ManagedBy   = "Terraform"
    Project     = "cashight"
  }
}

# v2 minimal and the full ephemeral platform both point
# api.cashight-v2.nghuy.link at their own ALB and would both consume the v2
# queues, so only one may exist (spec §4.1). scripts/platform/bring-up.sh has
# the mirror-image guard.
data "aws_eks_clusters" "all" {}

#
# The cluster name flows through this resource rather than a module-level
# depends_on: depends_on would defer every data source inside the EKS module
# to apply time (breaking its count expressions), while this still pulls the
# guard into `-target=module.cluster` applies (scripts/v2-minimal/apply.sh).
resource "terraform_data" "exclusive_with_full_platform" {
  input = local.cluster_name

  lifecycle {
    precondition {
      condition     = !contains(data.aws_eks_clusters.all.names, "cashight-v2")
      error_message = "The full v2 cluster cashight-v2 exists; tear it down (scripts/platform/teardown.sh) before applying v2-minimal."
    }
  }
}

# App logs only (spec decision 3): Fargate's built-in Fluent Bit ships the
# cashight namespace here (kubernetes.tf).
resource "aws_cloudwatch_log_group" "app" {
  #checkov:skip=CKV_AWS_158:AWS-owned encryption; the logs hold no secrets or PANs (PCI convention).
  #checkov:skip=CKV_AWS_338:7-day retention is the cost decision in spec §1 (decision 3).
  name              = local.log_group_name
  retention_in_days = 7
}

data "aws_iam_policy_document" "fargate_logging" {
  statement {
    sid       = "ShipAppLogs"
    effect    = "Allow"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents", "logs:DescribeLogStreams"]
    resources = [aws_cloudwatch_log_group.app.arn, "${aws_cloudwatch_log_group.app.arn}:*"]
  }
}

module "cluster" {
  source = "../modules/platform_cluster_fargate"

  cluster_name            = terraform_data.exclusive_with_full_platform.output
  vpc_cidr                = var.vpc_cidr
  kubernetes_version      = var.kubernetes_version
  admin_principal_arns    = var.admin_principal_arns
  ci_role_arn             = local.v2.github_ci_role_arn
  fargate_log_policy_json = data.aws_iam_policy_document.fargate_logging.json
  tags                    = local.tags
}
