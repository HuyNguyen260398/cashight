# Run with: terraform test (from terraform/grafana/).

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

run "check_disabled_until_api_live" {
  command = plan

  assert {
    condition     = grafana_synthetic_monitoring_check.api_health.enabled == false
    error_message = "Until api_live, the check exists but is disabled (spec 5.3)."
  }

  assert {
    condition = (
      grafana_synthetic_monitoring_check.api_health.target == "https://api.cashight-v2.nghuy.link/health" &&
      grafana_synthetic_monitoring_check.api_health.frequency == 120000 &&
      grafana_synthetic_monitoring_check.api_health.timeout == 5000
    )
    error_message = "The check probes /health every 2 minutes with a 5 s timeout."
  }

  assert {
    condition     = toset(grafana_synthetic_monitoring_check.api_health.probes) == toset([1, 2])
    error_message = "The check runs from Singapore and Tokyo only."
  }

  assert {
    condition     = toset(one(one(grafana_synthetic_monitoring_check.api_health.settings).http).valid_status_codes) == toset([200])
    error_message = "The check expects HTTP 200."
  }
}

run "check_enabled_when_api_live" {
  command = plan

  variables {
    api_live = true
  }

  assert {
    condition     = grafana_synthetic_monitoring_check.api_health.enabled == true
    error_message = "With api_live the check is enabled."
  }
}
