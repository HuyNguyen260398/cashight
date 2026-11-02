# By uid: Grafana Cloud names the data source after the stack slug, but its
# uid is the same in every stack.
data "grafana_data_source" "prometheus" {
  uid = "grafanacloud-prom"
}

# The five rules of spec 5, as data. Each rule is an instant query (A) over
# the last 10 minutes and a threshold (C) on it. Thresholds use Grafana's
# evaluator types: lt, gt.
locals {
  M = local.metric
  L = local.label

  rules = {
    "API down" = {
      expr      = "sum(max_over_time(probe_success{job=\"${local.check_job}\"}[6m]))"
      evaluator = "lt"
      threshold = 1
      critical  = true
      summary   = "The synthetic check has not reached /health from any probe for 6 minutes."
    }
    # With no series at all the query returns no data, which no_data_state
    # Alerting turns into firing.
    "Telemetry stopped" = {
      expr      = "count(max_over_time(${local.M.collector_uptime}[10m]))"
      evaluator = "lt"
      threshold = 1
      critical  = true
      summary   = "No collector has reported for 10 minutes: the cluster or the collector is down."
    }
    # The ratio only counts with at least 20 requests in the window, so one
    # failed request at night does not page.
    "API errors" = {
      expr      = "(sum(increase(${local.M.http_count}{${local.L.status}=~\"5..\"}[10m])) / sum(increase(${local.M.http_count}[10m])) > 0.05) and on() (sum(increase(${local.M.http_count}[10m])) >= 20)"
      evaluator = "gt"
      threshold = 0
      critical  = false
      summary   = "More than 5% of API requests answered 5xx over the last 10 minutes."
    }
    "Parse jobs failing" = {
      expr      = "sum(increase(${local.M.worker_jobs}{${local.L.outcome}!=\"succeeded\"}[15m]))"
      evaluator = "gt"
      threshold = 0
      critical  = false
      summary   = "A statement or invoice parse job failed in the last 15 minutes."
    }
    # Restarts are integers, so >= 3 is written > 2.5.
    "Pod crash-looping" = {
      expr      = "max by (${local.L.namespace}, ${local.L.pod}) (increase(${local.M.container_restarts}{${local.L.namespace}=~\"cashight|observability|keda\"}[15m]))"
      evaluator = "gt"
      threshold = 2.5
      critical  = false
      summary   = "A pod restarted 3 or more times in 15 minutes."
    }
  }
}

resource "grafana_rule_group" "cashight_v2" {
  name             = "cashight-v2"
  folder_uid       = grafana_folder.cashight_v2.uid
  interval_seconds = 60

  dynamic "rule" {
    for_each = local.rules
    content {
      name      = rule.key
      condition = "C"
      for       = rule.value.critical ? "0s" : "5m"
      # Both critical rules would fire permanently until the API serves.
      is_paused      = rule.value.critical ? !var.api_live : false
      no_data_state  = rule.value.critical ? "Alerting" : "OK"
      exec_err_state = "Error"
      labels         = { severity = rule.value.critical ? "critical" : "warning" }
      annotations    = { summary = rule.value.summary }

      data {
        ref_id         = "A"
        datasource_uid = data.grafana_data_source.prometheus.uid
        relative_time_range {
          from = 600
          to   = 0
        }
        model = jsonencode({
          refId   = "A"
          expr    = rule.value.expr
          instant = true
          range   = false
        })
      }

      data {
        ref_id         = "C"
        datasource_uid = "__expr__"
        relative_time_range {
          from = 0
          to   = 0
        }
        model = jsonencode({
          refId      = "C"
          type       = "threshold"
          expression = "A"
          datasource = { type = "__expr__", uid = "__expr__" }
          conditions = [{ evaluator = { type = rule.value.evaluator, params = [rule.value.threshold] } }]
        })
      }
    }
  }
}
