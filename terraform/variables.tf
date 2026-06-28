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
