variable "aws_region" {
  description = "AWS Region of v2 minimal."
  type        = string
  default     = "ap-southeast-1"
}

variable "vpc_cidr" {
  description = "CIDR block of the v2 minimal VPC; must not overlap the full platform's 10.0.0.0/16."
  type        = string
  default     = "10.1.0.0/16"
}

variable "kubernetes_version" {
  description = "EKS Kubernetes version. Only versions in standard support are accepted."
  type        = string
  default     = "1.35"

  # Versions in standard support on 2026-11-10, from:
  #   aws eks describe-cluster-versions --region ap-southeast-1 \
  #     --version-status STANDARD_SUPPORT --query 'clusterVersions[].clusterVersion'
  # Refresh this list before every upgrade; a version that has left standard
  # support bills extended support ($0.60/h instead of $0.10/h).
  validation {
    condition     = contains(["1.34", "1.35", "1.36", "1.37"], var.kubernetes_version)
    error_message = "kubernetes_version must be in EKS standard support (1.34-1.37 as of 2026-11-10); see the comment in variables.tf."
  }
}

variable "admin_principal_arns" {
  description = "IAM principals (the workstation admin role) granted cluster-admin through access entries."
  type        = list(string)

  validation {
    condition     = length(var.admin_principal_arns) > 0 && alltrue([for arn in var.admin_principal_arns : can(regex("^arn:aws:iam::[0-9]{12}:", arn))])
    error_message = "admin_principal_arns must list at least one IAM ARN."
  }
}

variable "lbc_chart_version" {
  description = "AWS Load Balancer Controller Helm chart version; matches the full platform's, which shares the IAM policy."
  type        = string
  default     = "1.14.0"
}
