variable "aws_region" {
  description = "AWS Region of the platform's account-level resources."
  type        = string
  default     = "ap-southeast-1"
}

variable "resource_prefix" {
  description = "Prefix applied to resource names and tags."
  type        = string
  default     = "cashight"
}

variable "argocd_admin_user_ids" {
  description = "Existing IAM Identity Center user IDs granted managed Argo CD administrator access."
  type        = set(string)

  validation {
    condition     = length(var.argocd_admin_user_ids) > 0
    error_message = "argocd_admin_user_ids must contain at least one IAM Identity Center user ID."
  }
}

variable "budget_notification_emails" {
  description = "Email addresses notified by the account budget. AWS Budgets sends to them directly; no subscription confirmation is needed."
  type        = list(string)

  validation {
    condition = length(var.budget_notification_emails) > 0 && alltrue([
      for email in var.budget_notification_emails : can(regex("^[^@\\s]+@[^@\\s]+$", email))
    ])
    error_message = "budget_notification_emails must contain at least one valid email address."
  }
}

variable "monthly_budget_usd" {
  description = "Account-wide monthly cost budget in USD. Alerts fire at 50%, 80% and 100% of actual spend and at 100% of forecast spend."
  type        = number
  default     = 50

  validation {
    condition     = var.monthly_budget_usd > 0
    error_message = "monthly_budget_usd must be greater than zero."
  }
}
