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

# Applied against the mocks so the folder uid is known.
run "dashboard_in_folder" {
  command = apply

  assert {
    condition     = grafana_dashboard.cashight_v2.folder == grafana_folder.cashight_v2.uid
    error_message = "The dashboard lives in the Cashight v2 folder."
  }

  assert {
    condition = (
      jsondecode(grafana_dashboard.cashight_v2.config_json).title == "Cashight v2" &&
      jsondecode(grafana_dashboard.cashight_v2.config_json).uid == "cashight-v2"
    )
    error_message = "The dashboard is titled 'Cashight v2' with uid cashight-v2."
  }
}

run "dashboard_uses_recorded_names" {
  command = plan

  assert {
    condition = alltrue([
      for key in [
        "http_count", "http_bucket", "worker_jobs", "worker_duration_bucket",
        "invoice_parse_failures", "container_restarts", "pod_memory", "node_memory",
      ] : strcontains(grafana_dashboard.cashight_v2.config_json, local.metric[key])
    ])
    error_message = "The dashboard queries the metric names recorded in metrics.tf."
  }
}

run "dashboard_has_no_hardcoded_datasource_uid" {
  command = plan

  assert {
    condition     = !strcontains(grafana_dashboard.cashight_v2.config_json, "mock-uid")
    error_message = "Panels take data source uids from the prom, logs and traces variables."
  }
}
