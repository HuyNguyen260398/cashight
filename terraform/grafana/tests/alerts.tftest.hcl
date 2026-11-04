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
run "five_rules_in_folder" {
  command = apply

  assert {
    condition     = length(grafana_rule_group.cashight_v2.rule) == 5
    error_message = "One rule group with five rules."
  }

  assert {
    condition = (
      grafana_rule_group.cashight_v2.folder_uid == grafana_folder.cashight_v2.uid &&
      grafana_rule_group.cashight_v2.interval_seconds == 60
    )
    error_message = "The group lives in the Cashight v2 folder and evaluates every 60 s."
  }

  assert {
    condition = toset([for r in grafana_rule_group.cashight_v2.rule : r.name]) == toset([
      "API down", "Telemetry stopped", "API errors", "Parse jobs failing", "Pod crash-looping",
    ])
    error_message = "The rules are named exactly as in spec 5."
  }
}

run "severity_and_pending" {
  command = plan

  assert {
    condition = alltrue([
      for r in grafana_rule_group.cashight_v2.rule :
      contains(["API down", "Telemetry stopped"], r.name)
      ? r.labels.severity == "critical" && r["for"] == "0s"
      : r.labels.severity == "warning" && r["for"] == "5m"
    ])
    error_message = "API down and Telemetry stopped are critical with no pending period; the rest are warning after 5m."
  }
}

run "no_data_states" {
  command = plan

  assert {
    condition = alltrue([
      for r in grafana_rule_group.cashight_v2.rule :
      r.no_data_state == (contains(["API down", "Telemetry stopped"], r.name) ? "Alerting" : "OK")
    ])
    error_message = "No data fires API down and Telemetry stopped and is OK for the rest."
  }
}

run "critical_rules_paused_by_default" {
  command = plan

  assert {
    condition = alltrue([
      for r in grafana_rule_group.cashight_v2.rule :
      r.is_paused == contains(["API down", "Telemetry stopped"], r.name)
    ])
    error_message = "With neither switch set, API down and Telemetry stopped are paused and the rest are not."
  }
}

# The collector exports before the API serves (Plan 3 before Plan 4); a
# collector outage in between must page.
run "telemetry_stopped_follows_collector_live_only" {
  command = plan

  variables {
    collector_live = true
  }

  assert {
    condition = alltrue([
      for r in grafana_rule_group.cashight_v2.rule :
      r.is_paused == (r.name == "API down")
    ])
    error_message = "With collector_live but not api_live, only API down stays paused."
  }
}

run "api_down_follows_api_live_only" {
  command = plan

  variables {
    api_live = true
  }

  assert {
    condition = alltrue([
      for r in grafana_rule_group.cashight_v2.rule :
      r.is_paused == (r.name == "Telemetry stopped")
    ])
    error_message = "With api_live but not collector_live, only Telemetry stopped stays paused."
  }
}

run "nothing_paused_when_both_live" {
  command = plan

  variables {
    api_live       = true
    collector_live = true
  }

  assert {
    condition     = alltrue([for r in grafana_rule_group.cashight_v2.rule : r.is_paused == false])
    error_message = "With api_live and collector_live no rule is paused."
  }
}

run "api_errors_needs_volume" {
  command = plan

  assert {
    condition = alltrue([
      for r in grafana_rule_group.cashight_v2.rule :
      strcontains(jsondecode(r.data[0].model).expr, ">= 20") && strcontains(jsondecode(r.data[0].model).expr, "0.05")
      if r.name == "API errors"
    ])
    error_message = "API errors needs a 5% error ratio over at least 20 requests."
  }

  # The histogram's series are born at their first request; increase() would
  # miss the first 5xx per route per pod.
  assert {
    condition = alltrue([
      for r in grafana_rule_group.cashight_v2.rule :
      !strcontains(jsondecode(r.data[0].model).expr, local.metric.http_count)
      if r.name == "API errors"
    ])
    error_message = "API errors reads the zero-initialised response counter, not the duration histogram."
  }
}

run "queries_use_recorded_names" {
  command = plan

  assert {
    condition = alltrue([
      for r in grafana_rule_group.cashight_v2.rule :
      strcontains(jsondecode(r.data[0].model).expr, lookup({
        "API down"           = local.check_job
        "Telemetry stopped"  = local.metric.collector_uptime
        "API errors"         = local.metric.http_responses
        "Parse jobs failing" = local.metric.worker_jobs
        "Pod crash-looping"  = local.metric.container_restarts
      }, r.name))
    ])
    error_message = "Each rule queries its recorded metric name (metrics.tf), and API down the check's job."
  }
}
