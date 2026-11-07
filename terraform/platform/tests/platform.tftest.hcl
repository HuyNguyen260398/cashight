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
