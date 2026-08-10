# outputs.tf — root module outputs
#
# Most outputs live alongside their resources in per-feature files
# (amplify.tf, cognito.tf, iam.tf, github-oidc.tf). New shared outputs
# added here as modules are populated in Tasks 11/12.

output "tfstate_kms_key_arn" {
  description = "ARN of the KMS key encrypting the Terraform state bucket."
  value       = aws_kms_key.tfstate.arn
}

output "session_capabilities_lambda_name" {
  description = "Name of the Lambda serving GET /session/capabilities."
  value       = aws_lambda_function.session_capabilities_api.function_name
}

output "cost_explorer_lambda_name" {
  description = "Name of the Lambda serving the authenticated AWS Cost Explorer API."
  value       = aws_lambda_function.cost_explorer_api.function_name
}

output "cost_explorer_lambda_alias_arn" {
  description = "Live alias ARN used by API Gateway for AWS Cost Explorer routes."
  value       = aws_lambda_alias.cost_explorer_api_live.arn
}

output "cost_exports_bucket_name" {
  description = "Private one-day-lifecycle bucket for Cost Explorer CSV exports."
  value       = aws_s3_bucket.cost_exports.bucket
}
