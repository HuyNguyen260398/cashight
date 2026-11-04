variable "grafana_url" {
  description = "Grafana Cloud stack URL, e.g. https://<stack>.grafana.net."
  type        = string
}

variable "grafana_auth" {
  description = "Token of the stack's terraform-cashight service account (Admin)."
  type        = string
  sensitive   = true
}

variable "sm_url" {
  description = "Synthetic Monitoring API URL for the stack's region (Synthetic Monitoring app > Config)."
  type        = string
}

variable "sm_access_token" {
  description = "Synthetic Monitoring access token."
  type        = string
  sensitive   = true
}

variable "api_live" {
  description = "Set once api.cashight-v2.nghuy.link serves (Plan 4). Until then the uptime check is disabled and the API down rule is paused, because it would fire permanently."
  type        = bool
  default     = false
}

variable "collector_live" {
  description = "Set once the cluster's OpenTelemetry Collector exports to Grafana Cloud. Until then the Telemetry stopped rule is paused, because it would fire permanently. Independent of api_live: the collector runs before the API serves, and an outage in between must page."
  type        = bool
  default     = false
}

variable "health_url" {
  description = "URL the synthetic check probes."
  type        = string
  default     = "https://api.cashight-v2.nghuy.link/health"
}

variable "slack_webhook_parameter" {
  description = "SSM SecureString holding the Slack incoming-webhook URL (created by hand, docs/observability.md)."
  type        = string
  default     = "/cashight/grafana/slack-webhook-url"
}
