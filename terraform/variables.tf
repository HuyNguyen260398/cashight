variable "region" {
  type    = string
  default = "ap-southeast-1"
}

variable "project_name" {
  type    = string
  default = "cashight"
}

variable "statements_bucket_name" {
  type        = string
  description = "S3 bucket name for parsed statement JSON objects"
  default     = "cashight-statements"
}

variable "bucket_suffix" {
  type        = string
  description = "Random suffix to ensure global uniqueness"
  default     = "cashight-2026"
}

variable "enable_security_alarms" {
  type        = bool
  description = "Create CloudWatch alarms and an optional SNS email subscription for Amplify security signals."
  default     = false
}

variable "alarm_email" {
  type        = string
  description = "Email address for optional security alarm notifications. Leave empty to create alarms without SNS actions."
  default     = ""
}

variable "allowed_email" {
  type        = string
  description = "Single email address permitted to sign in to Cashight."
  default     = ""
}

variable "enable_legacy_authz_fallback" {
  type        = bool
  description = "Temporary migration flag allowing strict, signed-username compatibility for legacy authorization records. Set false after authorization backfill validation."
  default     = true
}

variable "enable_legacy_workspace_fallback" {
  type        = bool
  description = "Temporary migration flag allowing reads from legacy subject-scoped statement data. Set false after object and metadata backfill validation."
  default     = true
}

variable "enable_cost_explorer_granular_data" {
  type        = bool
  description = "Expose Cost Explorer resource/hourly queries after the matching AWS account preference has been enabled out of band. Programmatic granular queries may incur additional charges."
  default     = false
}

variable "cost_explorer_granular_data_enabled_out_of_band" {
  type        = bool
  description = "Operator acknowledgement that the required Cost Explorer granular-data preference was already enabled manually in the AWS Billing console. Terraform never changes that account preference."
  default     = false
}

variable "cutover_dns_to_cloudfront" {
  type        = bool
  description = <<-EOT
    Phase 9 DNS cutover toggle. The cutover is complete, so this defaults to true
    and there is no longer a supported way to set it to false.

    true (current): a Route 53 ALIAS record points cashight.nghuy.link at the
                    CloudFront distribution, which serves both the production and
                    next.* aliases.

    false:          DO NOT SET. This destroys aws_route53_record.frontend_prod and
                    drops cashight.nghuy.link from the distribution's aliases, which
                    takes the production domain offline. The original rollback path
                    handed the record back to aws_amplify_domain_association, but the
                    Amplify resources were removed in Phase 10 — nothing re-creates
                    the record now.

    The default was false while the cutover was pending. That made an apply with no
    tfvars silently destroy production DNS, so it was flipped once the cutover landed.
    This variable is retained only so the existing count/conditional expressions keep
    working; it should be removed along with them.
  EOT
  default     = true
}
