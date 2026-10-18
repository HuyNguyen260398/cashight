# Run with: terraform test (from terraform/grafana/). Mock providers: no
# Grafana stack or AWS credentials needed.

mock_provider "grafana" {
  mock_data "grafana_synthetic_monitoring_probes" {
    defaults = { probes = { Singapore = 1, Tokyo = 2, Paris = 3 } }
  }
  mock_data "grafana_data_source" {
    defaults = { uid = "mock-uid" }
  }
}

mock_provider "aws" {
  mock_data "aws_ssm_parameter" {
    defaults = { value = "https://hooks.slack.com/services/T0/B0/x" }
  }
}

variables {
  grafana_url     = "https://x.grafana.net"
  grafana_auth    = "x"
  sm_url          = "https://sm.example"
  sm_access_token = "x"
}

run "folder_is_cashight_v2" {
  command = plan

  assert {
    condition     = grafana_folder.cashight_v2.title == "Cashight v2"
    error_message = "Alerts and the dashboard live in the folder 'Cashight v2'."
  }
}

run "slack_contact_point_reads_ssm" {
  command = plan

  assert {
    condition     = data.aws_ssm_parameter.slack_webhook.name == "/cashight/grafana/slack-webhook-url" && data.aws_ssm_parameter.slack_webhook.with_decryption
    error_message = "The Slack webhook URL is read, decrypted, from /cashight/grafana/slack-webhook-url."
  }

  assert {
    condition     = length(grafana_contact_point.slack.slack) == 1 && one(grafana_contact_point.slack.slack).disable_resolve_message == false
    error_message = "One Slack integration, with resolved notifications on."
  }
}

run "policy_timings" {
  command = plan

  assert {
    condition     = grafana_notification_policy.main.group_by == tolist(["alertname"])
    error_message = "Notifications are grouped by alertname."
  }

  assert {
    condition = (
      grafana_notification_policy.main.group_wait == "30s" &&
      grafana_notification_policy.main.group_interval == "5m" &&
      grafana_notification_policy.main.repeat_interval == "4h"
    )
    error_message = "Group wait 30s, group interval 5m, repeat interval 4h."
  }

  assert {
    condition     = grafana_notification_policy.main.contact_point == grafana_contact_point.slack.name
    error_message = "The policy routes to the Slack contact point."
  }
}
