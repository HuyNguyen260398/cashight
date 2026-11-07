variable "aws_region" {
  description = "AWS Region in which the platform cluster resources are created."
  type        = string
}

variable "resource_prefix" {
  description = "Prefix applied to platform cluster resource names."
  type        = string
}

variable "environment" {
  description = "Environment name applied to platform cluster resources."
  type        = string
}

variable "vpc_cidr" {
  description = "CIDR block assigned to the platform VPC."
  type        = string

  validation {
    condition     = can(cidrnetmask(var.vpc_cidr))
    error_message = "vpc_cidr must be a valid CIDR block."
  }
}

variable "kubernetes_version" {
  description = "Amazon EKS Kubernetes version for the platform cluster."
  type        = string
}

variable "public_access_cidrs" {
  description = "CIDR blocks allowed to access the public Amazon EKS API endpoint."
  type        = set(string)
}

variable "identity_store_id" {
  description = "IAM Identity Center identity store ID for platform access management."
  type        = string
}

variable "identity_center_instance_arn" {
  description = "ARN of the IAM Identity Center instance used by managed Argo CD."
  type        = string
}

variable "argocd_admin_group_id" {
  description = "IAM Identity Center group ID granted managed Argo CD administrator access."
  type        = string
}

variable "enable_argocd" {
  description = "Create the managed Argo CD capability, its IAM role and its cluster-admin access entry."
  type        = bool
}

variable "github_connection_arn" {
  description = "ARN of the AWS CodeConnections GitHub connection used by managed Argo CD."
  type        = string
}

variable "gitops_repo_url" {
  description = "AWS CodeConnections Git HTTP endpoint for the GitOps repository."
  type        = string
}

variable "tags" {
  description = "Tags applied to platform cluster resources."
  type        = map(string)
}

variable "node_instance_types" {
  description = "Graviton (arm64) EC2 instance types the node group may use. List several of the same size so Spot can draw from more pools."
  type        = list(string)
  default     = ["t4g.large"]

  validation {
    # Graviton families carry a "g" right after the generation number:
    # t4g, m7g, c7gn, r8gd. x86 types such as m5 or g5 do not match.
    condition = length(var.node_instance_types) > 0 && alltrue([
      for type in var.node_instance_types : can(regex("^[a-z]+[0-9]+g[a-z]*\\.[a-z0-9]+$", type))
    ])
    error_message = "node_instance_types must list Graviton (arm64) types such as t4g.medium; the node group uses an arm64 AMI."
  }
}

variable "node_capacity_type" {
  description = "Capacity type of the node group: SPOT or ON_DEMAND."
  type        = string
  default     = "ON_DEMAND"

  validation {
    condition     = contains(["SPOT", "ON_DEMAND"], var.node_capacity_type)
    error_message = "node_capacity_type must be SPOT or ON_DEMAND."
  }
}

variable "node_count" {
  description = "Fixed size of the general-purpose managed node group. Nodes spread across the three private subnets."
  type        = number
  default     = 2

  validation {
    condition     = var.node_count >= 1 && var.node_count <= 10 && floor(var.node_count) == var.node_count
    error_message = "node_count must be a whole number from 1 to 10."
  }
}

variable "grafana_cloud_parameter_path" {
  description = "SSM path holding the Grafana Cloud OTLP parameters; the collector may read <path>/*."
  type        = string

  validation {
    condition     = can(regex("^/[A-Za-z0-9_./-]+[^/]$", var.grafana_cloud_parameter_path))
    error_message = "grafana_cloud_parameter_path must start with / and must not end with /."
  }
}
