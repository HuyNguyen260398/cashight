# Prometheus names of the OTLP metrics the alert rules and dashboard query.
# Read from Explore after the local run of 2026-11-02 (docs/observability.md
# section 6); the rules and dashboard reference only these keys.
locals {
  metric = {
    http_count  = "http_server_request_duration_seconds_count"
    http_bucket = "http_server_request_duration_seconds_bucket"
    # Zero-initialised per pod and labelled by status class in `outcome`
    # (backend/server/http-server.ts). Derived from the OTLP name like
    # worker_jobs; confirm in Explore on the next drill.
    http_responses         = "cashight_http_server_responses_total"
    worker_jobs            = "cashight_worker_jobs_total"
    worker_duration_bucket = "cashight_worker_job_duration_seconds_bucket"
    # Derived from metricInstrumentName('AwsInvoiceParseFailure'); the drill
    # emits none, so it was not observed.
    invoice_parse_failures = "cashight_aws_invoice_parse_failure_total"
    collector_uptime       = "otelcol_process_uptime_total"
    # unverified until Plan 4 (handover item 1)
    container_restarts = "k8s_container_restarts"
    # unverified until Plan 4 (handover item 1)
    pod_cpu = "k8s_pod_cpu_usage"
    # unverified until Plan 4 (handover item 1)
    pod_memory = "k8s_pod_memory_working_set_bytes"
    # unverified until Plan 4 (handover item 1)
    node_memory = "k8s_node_memory_working_set_bytes"
    # unverified until Plan 4 (handover item 1)
    container_memory_limit = "k8s_container_memory_limit_bytes"
  }

  label = {
    status     = "http_response_status_code"
    route      = "http_route"
    outcome    = "outcome"
    error_code = "error_code"
    service    = "service_name"
    # unverified until Plan 4 (handover item 1)
    namespace = "k8s_namespace_name"
    # unverified until Plan 4 (handover item 1)
    pod = "k8s_pod_name"
  }
}
