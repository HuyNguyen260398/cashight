locals {
  check_job   = "cashight-v2-api-health"
  probe_names = ["Singapore", "Tokyo"]
}

# Probes /health from outside AWS, so it still alerts when the node is gone.
# Every 2 minutes from two probes is about 43k runs a month, under the free
# tier's 100k. Created disabled until api_live (spec 5.3).
resource "grafana_synthetic_monitoring_check" "api_health" {
  job     = local.check_job
  target  = var.health_url
  enabled = var.api_live
  # Indexing without a default fails the plan if a probe is renamed.
  probes    = [for name in local.probe_names : data.grafana_synthetic_monitoring_probes.all.probes[name]]
  frequency = 120000
  timeout   = 5000
  labels    = {}

  settings {
    http {
      method             = "GET"
      valid_status_codes = [200]
      fail_if_not_ssl    = true
    }
  }
}
