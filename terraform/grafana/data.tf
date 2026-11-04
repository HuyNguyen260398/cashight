data "grafana_synthetic_monitoring_probes" "all" {}

data "aws_ssm_parameter" "slack_webhook" {
  name            = var.slack_webhook_parameter
  with_decryption = true
}
