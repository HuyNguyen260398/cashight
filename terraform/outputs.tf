# outputs.tf — root module outputs
#
# Most outputs live alongside their resources in per-feature files
# (amplify.tf, cognito.tf, iam.tf, github-oidc.tf). New shared outputs
# added here as modules are populated in Tasks 11/12.

output "tfstate_kms_key_arn" {
  description = "ARN of the KMS key encrypting the Terraform state bucket."
  value       = aws_kms_key.tfstate.arn
}
