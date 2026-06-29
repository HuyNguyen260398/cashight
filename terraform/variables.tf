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

variable "cutover_dns_to_cloudfront" {
  type        = bool
  description = <<-EOT
    Phase 9 DNS cutover toggle.

    false (default): cashight.nghuy.link is managed by aws_amplify_domain_association.
                     CloudFront serves only next.cashight.nghuy.link (staging).

    true (cutover):  aws_amplify_domain_association is removed. A Route 53 ALIAS record
                     points cashight.nghuy.link at the CloudFront distribution directly.
                     The Amplify app and branch remain intact for rollback via re-apply.

    To roll back: set this to false and re-apply. Amplify re-provisions its DNS record.
  EOT
  default     = false
}
