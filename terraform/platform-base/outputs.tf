output "identity_store_id" {
  description = "IAM Identity Center identity store ID."
  value       = local.identity_store_id
}

output "identity_center_instance_arn" {
  description = "ARN of the IAM Identity Center instance."
  value       = local.identity_center_instance_arn
}

output "argocd_admin_group_id" {
  description = "IAM Identity Center group ID granted managed Argo CD administrator access."
  value       = aws_identitystore_group.argocd_admins.group_id
}

output "github_connection_arn" {
  description = "ARN of the AWS CodeConnections GitHub connection used by managed Argo CD."
  value       = aws_codeconnections_connection.github.arn
}

output "codeconnections_git_http_base" {
  description = "CodeConnections Git-HTTP base; a repository URL is <base>/<owner>/<repo>.git."
  value       = local.codeconnections_git_http_base
}

output "budget_name" {
  description = "Name of the account-wide monthly cost budget."
  value       = aws_budgets_budget.account_monthly.name
}
