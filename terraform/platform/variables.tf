variable "aws_region" {
  description = "AWS Region in which to create the platform environment."
  type        = string
  default     = "ap-southeast-1"
}

variable "resource_prefix" {
  description = "Prefix applied to platform resource names and tags."
  type        = string
  default     = "cashight"
}

variable "vpc_cidr" {
  description = "CIDR block assigned to the platform VPC."
  type        = string
  default     = "10.0.0.0/16"

  validation {
    condition     = can(cidrnetmask(var.vpc_cidr))
    error_message = "vpc_cidr must be a valid IPv4 or IPv6 CIDR block."
  }
}

variable "kubernetes_version" {
  description = "Amazon EKS Kubernetes version for the platform cluster."
  type        = string
  default     = "1.35"
}

variable "public_access_cidrs" {
  description = "CIDR blocks allowed to access the public Amazon EKS API endpoint."
  type        = set(string)

  validation {
    condition = length(var.public_access_cidrs) > 0 && alltrue([
      for cidr in var.public_access_cidrs : cidr != "0.0.0.0/0" && can(cidrnetmask(cidr))
    ])
    error_message = "public_access_cidrs must contain valid CIDRs and must not include 0.0.0.0/0."
  }
}

variable "github_owner" {
  description = "GitHub owner of the GitOps repository."
  type        = string
  default     = "HuyNguyen260398"

  validation {
    condition     = length(trimspace(var.github_owner)) > 0
    error_message = "github_owner must not be empty."
  }
}

variable "github_repository" {
  description = "GitOps repository Argo CD reconciles through AWS CodeConnections."
  type        = string
  default     = "cashight"

  validation {
    condition     = length(trimspace(var.github_repository)) > 0
    error_message = "github_repository must not be empty."
  }
}

variable "gitops_platform_path" {
  description = "Repository path containing managed Argo CD platform configuration."
  type        = string
  default     = "deploy/platform/"

  validation {
    condition     = startswith(var.gitops_platform_path, "deploy/platform/") && endswith(var.gitops_platform_path, "/")
    error_message = "gitops_platform_path must be rooted at deploy/platform/ and end with a slash."
  }
}

variable "gitops_revision" {
  description = "Git revision managed Argo CD reconciles for platform configuration."
  type        = string
  default     = "cashight-v2"

  validation {
    condition     = length(trimspace(var.gitops_revision)) > 0
    error_message = "gitops_revision must not be empty."
  }
}

variable "node_instance_types" {
  description = "Graviton (arm64) EC2 instance types for the node group, all the same size."
  type        = list(string)
  default     = ["t4g.large"]
}

variable "node_capacity_type" {
  description = "Capacity type of the node group: SPOT or ON_DEMAND."
  type        = string
  default     = "ON_DEMAND"
}

variable "node_count" {
  description = "Fixed size of the node group."
  type        = number
  default     = 2
}

variable "enable_argocd" {
  description = "Create the managed Argo CD capability and the GitOps bootstrap. On by default: a test cluster without Argo CD is useless, and the capability only bills while the cluster exists."
  type        = bool
  default     = true
}

variable "api_alb_ready" {
  description = "Set once Argo CD has synced the cashight Ingress and its ALB exists. Creates the api.cashight-v2.nghuy.link records (scripts/platform/bring-up.sh)."
  type        = bool
  default     = false
}
