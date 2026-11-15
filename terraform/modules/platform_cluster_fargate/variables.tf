variable "cluster_name" {
  description = "Name of the Fargate-only EKS cluster; also the prefix of its IAM roles."
  type        = string
}

variable "vpc_cidr" {
  description = "CIDR block of the cluster VPC. The default never overlaps the full platform's 10.0.0.0/16."
  type        = string
  default     = "10.1.0.0/16"

  validation {
    condition     = can(cidrnetmask(var.vpc_cidr))
    error_message = "vpc_cidr must be a valid CIDR block."
  }
}

variable "kubernetes_version" {
  description = "EKS Kubernetes version. The root restricts it to versions in standard support."
  type        = string
}

variable "admin_principal_arns" {
  description = "IAM principals granted cluster-wide AmazonEKSClusterAdminPolicy through access entries."
  type        = list(string)
}

variable "ci_role_arn" {
  description = "The v2 CI role; granted AmazonEKSEditPolicy scoped to the cashight namespace."
  type        = string
}

variable "fargate_log_policy_json" {
  description = "Inline policy for the Fargate pod execution role that lets Fargate's Fluent Bit write the app log group."
  type        = string
}

variable "tags" {
  description = "Tags applied to the module's resources (the provider's default_tags also apply)."
  type        = map(string)
  default     = {}
}
