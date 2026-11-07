# Persistent identifiers (Identity Center, Argo CD admin group, CodeConnections
# connection) live in the platform-base root and survive every teardown.
data "terraform_remote_state" "platform_base" {
  backend = "s3"

  config = {
    bucket     = "cashight-tfstate"
    key        = "cashight/platform-base/terraform.tfstate"
    region     = "ap-southeast-1"
    encrypt    = true
    kms_key_id = "alias/cashight-tfstate"
  }
}

locals {
  base                         = data.terraform_remote_state.platform_base.outputs
  gitops_repo_url              = "${local.base.codeconnections_git_http_base}/${var.github_owner}/${var.github_repository}.git"
  grafana_cloud_parameter_path = "/cashight/grafana-cloud"
  tags = {
    Environment = "v2"
    ManagedBy   = "Terraform"
    Project     = var.resource_prefix
  }
}

check "platform_root_inputs" {
  assert {
    condition = (
      can(cidrnetmask(var.vpc_cidr)) &&
      length(trimspace(var.kubernetes_version)) > 0 &&
      length(var.public_access_cidrs) > 0 &&
      alltrue([for cidr in var.public_access_cidrs : cidr != "0.0.0.0/0" && can(cidrnetmask(cidr))])
    )
    error_message = "The platform root requires a valid VPC CIDR, Kubernetes version, and restricted public access CIDRs."
  }
}

module "platform_cluster" {
  source = "../modules/platform_cluster"

  aws_region                   = var.aws_region
  resource_prefix              = var.resource_prefix
  environment                  = "v2"
  vpc_cidr                     = var.vpc_cidr
  kubernetes_version           = var.kubernetes_version
  node_instance_types          = var.node_instance_types
  node_capacity_type           = var.node_capacity_type
  node_count                   = var.node_count
  enable_argocd                = var.enable_argocd
  public_access_cidrs          = var.public_access_cidrs
  identity_store_id            = local.base.identity_store_id
  identity_center_instance_arn = local.base.identity_center_instance_arn
  argocd_admin_group_id        = local.base.argocd_admin_group_id
  github_connection_arn        = local.base.github_connection_arn
  gitops_repo_url              = local.gitops_repo_url
  grafana_cloud_parameter_path = local.grafana_cloud_parameter_path
  tags                         = local.tags
}

# The Terraform -> Argo CD handoff. Its kubernetes_manifest needs a live API
# server during plan, so the first apply targets module.platform_cluster
# (docs/platform.md, Bring-up).
module "platform_bootstrap" {
  source = "../modules/platform_bootstrap"
  count  = var.enable_argocd ? 1 : 0

  cluster_name                          = module.platform_cluster.cluster_name
  cluster_arn                           = module.platform_cluster.cluster_arn
  environment                           = "v2"
  gitops_repo_url                       = local.gitops_repo_url
  gitops_platform_path                  = var.gitops_platform_path
  gitops_revision                       = var.gitops_revision
  vpc_id                                = module.platform_cluster.vpc_id
  aws_region                            = var.aws_region
  aws_load_balancer_controller_role_arn = module.platform_cluster.aws_load_balancer_controller_role_arn
  grafana_cloud_parameter_path          = local.grafana_cloud_parameter_path

  depends_on = [module.platform_cluster]
}
