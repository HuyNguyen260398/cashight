locals {
  availability_zones = slice(data.aws_availability_zones.available.names, 0, 3)
  cluster_name       = "${var.resource_prefix}-${var.environment}"

  public_subnets = [
    for index in range(length(local.availability_zones)) : cidrsubnet(var.vpc_cidr, 8, index)
  ]

  private_subnets = [
    for index in range(length(local.availability_zones)) : cidrsubnet(var.vpc_cidr, 8, index + length(local.availability_zones))
  ]
}

check "platform_cluster_inputs" {
  assert {
    condition = (
      length(trimspace(var.aws_region)) > 0 &&
      length(trimspace(var.kubernetes_version)) > 0 &&
      length(var.public_access_cidrs) > 0 &&
      alltrue([for cidr in var.public_access_cidrs : can(cidrnetmask(cidr))]) &&
      length(trimspace(var.identity_store_id)) > 0 &&
      length(trimspace(var.identity_center_instance_arn)) > 0 &&
      length(trimspace(var.argocd_admin_group_id)) > 0 &&
      length(trimspace(var.github_connection_arn)) > 0 &&
      length(trimspace(var.gitops_repo_url)) > 0
    )
    error_message = "The platform cluster requires Region, EKS, endpoint CIDR, Identity Center, and GitHub connection inputs."
  }
}

# A Spot node group should list instance types of one size: the scheduler sees
# whichever type Spot picks, so a smaller fallback silently shrinks the node
# the whole platform runs on.
data "aws_ec2_instance_type" "node" {
  for_each      = toset(var.node_instance_types)
  instance_type = each.value
}

check "node_instance_types_same_size" {
  assert {
    condition = (
      length(distinct([for type in data.aws_ec2_instance_type.node : type.default_vcpus])) == 1 &&
      length(distinct([for type in data.aws_ec2_instance_type.node : type.memory_size])) == 1
    )
    error_message = "node_instance_types must all have the same vCPU count and memory; a smaller Spot fallback would shrink the only node."
  }
}
