resource "grafana_folder" "cashight_v2" {
  title = "Cashight v2"
}

resource "grafana_contact_point" "slack" {
  name = "slack-cashight"

  slack {
    url                     = data.aws_ssm_parameter.slack_webhook.value
    disable_resolve_message = false
  }
}

# The stack's single notification policy tree. This stack exists only for
# Cashight v2, so the root policy is ours.
resource "grafana_notification_policy" "main" {
  contact_point   = grafana_contact_point.slack.name
  group_by        = ["alertname"]
  group_wait      = "30s"
  group_interval  = "5m"
  repeat_interval = "4h"
}
