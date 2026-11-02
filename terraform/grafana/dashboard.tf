# Loaded with file(), not templatefile(): Grafana's own ${...} variables fill
# the JSON. Metric names are written literally; tests/dashboard.tftest.hcl
# pins them to metrics.tf.
resource "grafana_dashboard" "cashight_v2" {
  config_json = file("${path.module}/dashboards/cashight-v2.json")
  folder      = grafana_folder.cashight_v2.uid
  overwrite   = true
}
