#!/usr/bin/env bash
# Render the OpenTelemetry Collector add-on the way Argo CD would, without a
# cluster. Writes into <out-dir>:
#
#   manifests.yaml  helm template of the chart source + kustomize build of the
#                   observability source
#   config.yaml     the collector config (the rendered ConfigMap's relay key)
#   config-local.yaml
#                   the same pipeline minus the Kubernetes components, for
#                   scripts/platform/run-local-collector.sh: file_log reads
#                   /var/log/local/*.log, every pipeline also writes
#                   /var/log/local/collected.jsonl, and logs are labelled as
#                   namespace cashight so the dashboard's queries match
#
# The ApplicationSet's Go-template placeholders are replaced with this
# platform's values; any placeholder left over fails the render.
set -euo pipefail

if [ $# -ne 1 ]; then
  echo "usage: $0 <out-dir>" >&2
  exit 2
fi
out="$1"
mkdir -p "$out"

cd "$(git rev-parse --show-toplevel)"
appset=deploy/platform/config/addons/opentelemetry-collector.yaml
chart_source='.spec.template.spec.sources[0]'

repo_url="$(yq "$chart_source.repoURL" "$appset")"
chart="$(yq "$chart_source.chart" "$appset")"
version="$(yq "$chart_source.targetRevision" "$appset")"
release="$(yq "$chart_source.helm.releaseName" "$appset")"

values="$out/values.yaml"
yq "$chart_source.helm.values" "$appset" |
  sed -e 's|{{ \.metadata\.annotations\.aws_region }}|ap-southeast-1|g' \
    -e 's|{{ \.metadata\.annotations\.grafana_cloud_parameter_path }}|/cashight/grafana-cloud|g' >"$values"
if grep -n '{{' "$values" >&2; then
  echo "unreplaced Go-template placeholder in $appset helm values" >&2
  exit 1
fi

helm template "$release" "$chart" --repo "$repo_url" --version "$version" \
  --namespace observability -f "$values" >"$out/manifests.yaml"
{
  echo "---"
  kubectl kustomize deploy/platform/config/observability
} >>"$out/manifests.yaml"

yq ea 'select(.kind == "ConfigMap" and has("data") and (.data | has("relay"))) | .data.relay' \
  "$out/manifests.yaml" >"$out/config.yaml"
if [ ! -s "$out/config.yaml" ]; then
  echo "no ConfigMap with a relay key in the render" >&2
  exit 1
fi

yq '
  del(.receivers.kubeletstats) | del(.receivers.k8s_cluster) |
  del(.processors.k8s_attributes) | del(.extensions.k8s_leader_elector) |
  .service.extensions |= map(select(. != "k8s_leader_elector")) |
  .service.pipelines[].receivers |= map(select(. != "kubeletstats" and . != "k8s_cluster")) |
  .service.pipelines[].processors |= map(select(. != "k8s_attributes")) |
  .receivers.file_log.include = ["/var/log/local/*.log"] |
  .receivers.file_log.exclude = [] |
  .receivers.file_log.operators = [] |
  .receivers.file_log.start_at = "beginning" |
  .exporters["file/local"] = {"path": "/var/log/local/collected.jsonl"} |
  .service.pipelines[].exporters += ["file/local"] |
  .processors["transform/local"] = {"log_statements": [{"context": "resource", "statements": [
    "set(attributes[\"k8s.namespace.name\"], \"cashight\")",
    "set(attributes[\"service.name\"], \"cashight-local\")"]}]} |
  .service.pipelines.logs.processors |= (.[:-1] + ["transform/local"] + .[-1:])
' "$out/config.yaml" >"$out/config-local.yaml"

echo "$out"
