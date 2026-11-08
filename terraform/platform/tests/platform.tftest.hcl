# Run with: terraform test (from terraform/platform/). Mock providers: no AWS
# credentials, platform-base state or cluster needed.

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
  mock_data "aws_iam_session_context" {
    defaults = { issuer_arn = "arn:aws:iam::111122223333:user/test" }
  }
  mock_resource "aws_iam_role" {
    defaults = { arn = "arn:aws:iam::111122223333:role/mock" }
  }
}
mock_provider "kubernetes" {}
mock_provider "tls" {}
mock_provider "time" {}
mock_provider "cloudinit" {}
mock_provider "null" {}

override_data {
  target = data.terraform_remote_state.platform_base
  values = {
    outputs = {
      identity_store_id             = "d-1"
      identity_center_instance_arn  = "arn:aws:sso:::instance/ssoins-1"
      argocd_admin_group_id         = "g-1"
      github_connection_arn         = "arn:aws:codeconnections:ap-southeast-1:111122223333:connection/abc"
      codeconnections_git_http_base = "https://codeconnections.ap-southeast-1.amazonaws.com/git-http/111122223333/ap-southeast-1/abc"
    }
  }
}

override_data {
  target = data.terraform_remote_state.v2
  values = {
    outputs = {
      table_arn               = "arn:aws:dynamodb:ap-southeast-1:111122223333:table/cashight-v2"
      statements_bucket_arn   = "arn:aws:s3:::cashight-v2-statements-111122223333"
      uploads_bucket_arn      = "arn:aws:s3:::cashight-v2-uploads-111122223333"
      cost_exports_bucket_arn = "arn:aws:s3:::cashight-v2-cost-exports-111122223333"
      parse_queue_arn         = "arn:aws:sqs:ap-southeast-1:111122223333:cashight-v2-parse"
      invoice_parse_queue_arn = "arn:aws:sqs:ap-southeast-1:111122223333:cashight-v2-invoice-parse"
    }
  }
}

override_data {
  target = module.platform_cluster.data.aws_availability_zones.available
  values = {
    names = ["ap-southeast-1a", "ap-southeast-1b", "ap-southeast-1c"]
  }
}

override_data {
  target = module.platform_cluster.data.aws_ec2_instance_type.node
  values = {
    default_vcpus = 2
    memory_size   = 8192
  }
}

variables {
  public_access_cidrs = ["203.0.113.10/32"]
}

run "two_on_demand_t4g_large_nodes" {
  command = plan

  # node_group_name derives from node_group_id, which is known only after
  # apply. The node group's name is the literal "<cluster_name>-general"
  # (modules/platform_cluster/eks.tf), so the cluster name pins it at plan.
  assert {
    condition = (
      module.platform_cluster.cluster_name == "cashight-v2" &&
      var.node_count == 2 && var.node_capacity_type == "ON_DEMAND" &&
      var.node_instance_types == tolist(["t4g.large"])
    )
    error_message = "2 x t4g.large ON_DEMAND on cluster cashight-v2"
  }
}

run "gitops_points_at_cashight_v2" {
  command = plan

  assert {
    condition     = output.gitops_repo_url == "https://codeconnections.ap-southeast-1.amazonaws.com/git-http/111122223333/ap-southeast-1/abc/HuyNguyen260398/cashight.git"
    error_message = "repo URL"
  }

  assert {
    condition     = var.gitops_revision == "cashight-v2" && var.gitops_platform_path == "deploy/platform/"
    error_message = "revision and path"
  }
}

run "collector_reads_cashight_prefix" {
  command = plan

  assert {
    condition     = output.grafana_cloud_parameter_path == "/cashight/grafana-cloud"
    error_message = "SSM path"
  }
}

run "rejects_open_endpoint" {
  command = plan

  variables {
    public_access_cidrs = ["0.0.0.0/0"]
  }

  expect_failures = [var.public_access_cidrs]
}

run "argocd_off_skips_bootstrap" {
  command = plan

  variables {
    enable_argocd = false
  }

  assert {
    condition     = length(module.platform_bootstrap) == 0
    error_message = "bootstrap gated on enable_argocd"
  }
}

run "workload_roles" {
  command = plan

  override_resource {
    target          = module.platform_cluster.aws_iam_role.keda_operator
    override_during = plan
    values = {
      arn = "arn:aws:iam::111122223333:role/cashight-v2-keda-operator"
    }
  }

  assert {
    condition = (
      length(aws_eks_pod_identity_association.workload) == 4 &&
      alltrue([for a in aws_eks_pod_identity_association.workload : a.namespace == "cashight"])
    )
    error_message = "four Pod Identity associations in namespace cashight"
  }

  assert {
    condition = (
      aws_eks_pod_identity_association.workload["api"].service_account == "cashight-api" &&
      aws_eks_pod_identity_association.workload["aws-api"].service_account == "cashight-aws-api" &&
      aws_eks_pod_identity_association.workload["parser-worker"].service_account == "parser-worker" &&
      aws_eks_pod_identity_association.workload["invoice-parser-worker"].service_account == "invoice-parser-worker"
    )
    error_message = "ServiceAccount names"
  }

  assert {
    condition     = aws_iam_role.workload["api"].name == "cashight-v2-api"
    error_message = "role names are cashight-v2-<workload>"
  }

  assert {
    condition = contains(
      flatten([for s in data.aws_iam_policy_document.keda_scaler_trust["parse"].statement : [for p in s.principals : p.identifiers]]),
      "arn:aws:iam::111122223333:role/cashight-v2-keda-operator"
    )
    error_message = "KEDA scaler roles trust the KEDA operator role"
  }

  assert {
    condition = (
      length(data.aws_iam_policy_document.keda_scaler["parse"].statement) == 1 &&
      toset(data.aws_iam_policy_document.keda_scaler["parse"].statement[0].actions) == toset(["sqs:GetQueueAttributes"]) &&
      toset(data.aws_iam_policy_document.keda_scaler["parse"].statement[0].resources) == toset(["arn:aws:sqs:ap-southeast-1:111122223333:cashight-v2-parse"])
    )
    error_message = "the parse scaler may only read its own queue's attributes"
  }

  assert {
    condition = alltrue(flatten([
      for k, d in data.aws_iam_policy_document.workload : [
        for s in d.statement : [for a in s.actions : !endswith(a, ":*")]
      ]
    ]))
    error_message = "no wildcard actions in workload policies"
  }

  assert {
    condition = alltrue(flatten([
      for k, d in data.aws_iam_policy_document.workload : [
        for s in d.statement : !contains(s.resources, "*") || (k == "aws-api" && contains(["CostExplorerRead", "BillingRead"], s.sid))
      ]
    ]))
    error_message = "Resource * only on aws-api Cost Explorer and Billing reads"
  }

  assert {
    condition = (
      contains(flatten([for s in data.aws_iam_policy_document.workload["parser-worker"].statement : s.resources]), "arn:aws:ssm:ap-southeast-1:111122223333:parameter/cashight/prod/pdf-password") &&
      !contains(flatten([for s in data.aws_iam_policy_document.workload["api"].statement : s.resources]), "arn:aws:ssm:ap-southeast-1:111122223333:parameter/cashight/prod/pdf-password")
    )
    error_message = "only parser-worker reads the PDF password"
  }
}

run "api_record_off_by_default" {
  command = plan

  assert {
    condition     = length(aws_route53_record.api) == 0 && length(data.aws_lb.cashight) == 0
    error_message = "no ALB lookup or api record until api_alb_ready"
  }
}

run "api_record_on" {
  command = plan

  variables {
    api_alb_ready = true
  }

  override_data {
    target = data.aws_lb.cashight[0]
    values = {
      dns_name = "k8s-cashight-0123456789-111111111.ap-southeast-1.elb.amazonaws.com"
      zone_id  = "Z1LMS91P8CMLE5"
    }
  }

  assert {
    condition = (
      toset(keys(aws_route53_record.api)) == toset(["A", "AAAA"]) &&
      alltrue([for r in aws_route53_record.api : r.name == "api.cashight-v2.nghuy.link"])
    )
    error_message = "A and AAAA alias records for api.cashight-v2.nghuy.link"
  }

  assert {
    condition = (
      data.aws_lb.cashight[0].tags["elbv2.k8s.aws/cluster"] == "cashight-v2" &&
      data.aws_lb.cashight[0].tags["ingress.k8s.aws/stack"] == "cashight"
    )
    error_message = "ALB looked up by the controller's cluster and ingress-group tags"
  }

  assert {
    condition     = output.api_hostname == "api.cashight-v2.nghuy.link"
    error_message = "api_hostname output"
  }
}
